import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { creditsToUsdt, settleCost, stakingFee, workerEarn } from "@0c/credits";
import { SCHEMA_SQL } from "./schema.js";

export type LedgerReason =
  | "grant"
  | "reserve"
  | "settle"
  | "refund"
  | "earn"
  | "purchase"
  | "stake"
  | "unstake"
  | "stake_reward"
  | "withdraw"
  | "withdraw_refund";

export interface WithdrawalRow {
  id: string;
  user_id: string;
  credits: number;
  amount: number;
  currency: string;
  address: string;
  status: string;
  signature: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export class WithdrawalError extends Error {}

export interface XLinkRow {
  code: string;
  user_id: string;
  wallet: string;
  x_handle: string | null;
  verified: number;
  created_at: number;
  verified_at: number | null;
}

/** Fixed-point scale for the reward-per-share accumulator (keeps float error tiny). */
const ACC_SCALE = 1e12;

export interface LedgerRow {
  id: string;
  user_id: string;
  delta: number;
  reason: string;
  source: string;
  ref: string | null;
  created_at: number;
}

export class InsufficientCreditsError extends Error {
  constructor(public balance: number, public needed: number) {
    super(`insufficient credits: have ${balance}, need ${needed}`);
    this.name = "InsufficientCreditsError";
  }
}

export interface SettleResult {
  charge: number;
  balance: number;
  earn: number;
}

export function createDb(dbPath: string, opts: { signupGrant?: number } = {}) {
  const signupGrant = opts.signupGrant ?? 500;
  if (dbPath !== ":memory:") {
    const dir = dirname(dbPath);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);

  // migrate an older withdrawals table (usdc -> amount, add currency)
  try { db.exec("ALTER TABLE withdrawals RENAME COLUMN usdc TO amount"); } catch { /* already amount */ }
  try { db.exec("ALTER TABLE withdrawals ADD COLUMN currency TEXT NOT NULL DEFAULT 'SOL'"); } catch { /* exists */ }
  // older attestations predate per-record signing keys
  try { db.exec("ALTER TABLE attestations ADD COLUMN public_key TEXT"); } catch { /* exists */ }
  // optional, signature-verified wallet linked to an account
  try { db.exec("ALTER TABLE users ADD COLUMN wallet TEXT"); } catch { /* exists */ }
  // Per-user Ethereum deposit address index (BIP-44 m/44'/60'/0'/0/<n>). Assigned
  // on first use and never reused, so the address survives a database restore.
  try { db.exec("ALTER TABLE users ADD COLUMN deposit_index INTEGER"); } catch { /* exists */ }
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_deposit_index ON users(deposit_index)");
  } catch { /* exists */ }
  // Settlement moved from Solana to Ethereum; relabel historical deposit rows so
  // the withdrawal cap keeps counting them as real money in.
  try {
    db.exec("UPDATE ledger_entries SET source = 'deposit_eth' WHERE source = 'deposit_solana'");
  } catch { /* nothing to migrate */ }
  try { db.exec("UPDATE withdrawals SET currency = 'ETH' WHERE currency = 'SOL'"); } catch { /* none */ }

  const now = () => Date.now();

  /* ---- statements ---- */
  const insUser = db.prepare(
    "INSERT OR IGNORE INTO users (id, display_name, is_worker, created_at) VALUES (?, ?, ?, ?)",
  );
  const getUser = db.prepare("SELECT * FROM users WHERE id = ?");
  const setUserWallet = db.prepare("UPDATE users SET wallet = ? WHERE id = ?");
  const insLedger = db.prepare(
    "INSERT INTO ledger_entries (id, user_id, delta, reason, source, ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const sumBalance = db.prepare(
    "SELECT COALESCE(SUM(delta), 0) AS bal FROM ledger_entries WHERE user_id = ?",
  );
  const insJob = db.prepare(
    "INSERT INTO jobs (id, user_id, model, status, reserve, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const updJob = db.prepare(
    "UPDATE jobs SET status=?, charge=?, prompt_tokens=?, completion_tokens=?, served_by=?, updated_at=? WHERE id=?",
  );
  const upsKey = db.prepare(
    "INSERT INTO public_keys (user_id, public_key, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET public_key=excluded.public_key, updated_at=excluded.updated_at",
  );
  const getKey = db.prepare("SELECT public_key FROM public_keys WHERE user_id = ?");
  const insMsg = db.prepare(
    "INSERT INTO messages (id, from_user, to_user, ciphertext, nonce, epk, ts, delivered) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
  );
  const getUndelivered = db.prepare(
    "SELECT * FROM messages WHERE to_user = ? AND delivered = 0 ORDER BY ts ASC",
  );
  const markDelivered = db.prepare("UPDATE messages SET delivered = 1 WHERE id = ?");
  const ledgerHistory = db.prepare(
    "SELECT * FROM ledger_entries WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
  );

  // staking statements
  const getStakeState = db.prepare("SELECT * FROM staking_state WHERE id = 1");
  const updStakeState = db.prepare(
    "UPDATE staking_state SET total_staked = ?, acc_reward_per_share = ?, lifetime_rewards = ? WHERE id = 1",
  );
  const getStakeRow = db.prepare("SELECT * FROM stakes WHERE user_id = ?");
  const upsStake = db.prepare(
    "INSERT INTO stakes (user_id, amount, reward_debt, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET amount=excluded.amount, reward_debt=excluded.reward_debt, updated_at=excluded.updated_at",
  );

  // withdrawals
  const insWithdrawal = db.prepare(
    "INSERT INTO withdrawals (id, user_id, credits, amount, currency, address, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'requested', ?, ?)",
  );
  const updWithdrawal = db.prepare(
    "UPDATE withdrawals SET status=?, signature=?, error=?, updated_at=? WHERE id=?",
  );
  const getWithdrawal = db.prepare("SELECT * FROM withdrawals WHERE id=?");
  const withdrawalsList = db.prepare(
    "SELECT * FROM withdrawals WHERE user_id=? ORDER BY created_at DESC LIMIT ?",
  );
  const withdrawnTodaySum = db.prepare(
    "SELECT COALESCE(SUM(credits),0) AS s FROM withdrawals WHERE user_id=? AND created_at>=? AND status!='failed'",
  );

  // Only money that actually came IN (deposits) or was genuinely earned may be
  // withdrawn. Free signup grants are spendable but never cashable, so inventing
  // accounts can't drain the treasury.
  const sumHardIn = db.prepare(
    "SELECT COALESCE(SUM(delta),0) AS s FROM ledger_entries WHERE user_id = ? AND delta > 0 AND source IN ('purchase','deposit_eth','deposit_solana','earn')",
  );
  const sumWithdrawn = db.prepare(
    "SELECT COALESCE(SUM(credits),0) AS s FROM withdrawals WHERE user_id = ? AND status != 'failed'",
  );

  // attestations + settings
  const insAttest = db.prepare(
    "INSERT OR REPLACE INTO attestations (run_id, project_id, prompt, prompt_sha256, verified, signature, public_key, transcript_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const getAttest = db.prepare("SELECT * FROM attestations WHERE run_id = ?");
  const listAttest = db.prepare("SELECT * FROM attestations ORDER BY created_at DESC LIMIT ?");
  const getSetting = db.prepare("SELECT value FROM app_settings WHERE key = ?");
  const setSetting = db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  );

  const getAristotleProject = db.prepare(
    "SELECT project_id FROM aristotle_projects WHERE user_id = ? AND conversation_id = ?",
  );
  const setAristotleProject = db.prepare(
    "INSERT INTO aristotle_projects (user_id, conversation_id, project_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, conversation_id) DO UPDATE SET project_id=excluded.project_id, updated_at=excluded.updated_at",
  );

  // X bot statements
  const insXLink = db.prepare(
    "INSERT INTO x_links (code, user_id, wallet, created_at) VALUES (?, ?, ?, ?)",
  );
  const getXLinkByCode = db.prepare("SELECT * FROM x_links WHERE code = ?");
  const verifyXLink = db.prepare(
    "UPDATE x_links SET x_handle = ?, verified = 1, verified_at = ? WHERE code = ?",
  );
  const getXLinkByHandle = db.prepare(
    "SELECT * FROM x_links WHERE x_handle = ? AND verified = 1 ORDER BY verified_at DESC LIMIT 1",
  );
  const getXLinkByUser = db.prepare(
    "SELECT * FROM x_links WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
  );
  const getXCursor = db.prepare("SELECT last_mention_id FROM x_bot_state WHERE id = 1");
  const setXCursor = db.prepare("UPDATE x_bot_state SET last_mention_id = ? WHERE id = 1");
  const getXRequest = db.prepare("SELECT tweet_id FROM x_requests WHERE tweet_id = ?");
  const insXRequest = db.prepare(
    "INSERT OR IGNORE INTO x_requests (tweet_id, x_handle, command, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const updXRequest = db.prepare("UPDATE x_requests SET status = ?, detail = ? WHERE tweet_id = ?");
  const countXToday = db.prepare(
    "SELECT COUNT(*) AS n FROM x_requests WHERE x_handle = ? AND created_at >= ? AND status IN ('accepted','replied')",
  );

  function balanceOf(userId: string): number {
    return (sumBalance.get(userId) as { bal: number }).bal;
  }

  /**
   * How much of the balance may be cashed out. Capped by lifetime deposits +
   * earnings minus what has already been withdrawn, so grant credits can never
   * leave as real money.
   */
  function withdrawableOf(userId: string): number {
    const hardIn = (sumHardIn.get(userId) as { s: number }).s;
    const withdrawn = (sumWithdrawn.get(userId) as { s: number }).s;
    return Math.max(0, Math.min(balanceOf(userId), hardIn - withdrawn));
  }

  interface StakeState {
    total_staked: number;
    acc_reward_per_share: number;
    lifetime_rewards: number;
  }
  interface StakeRow {
    amount: number;
    reward_debt: number;
  }
  const stakeState = () => getStakeState.get() as StakeState;
  const stakeRow = (userId: string): StakeRow =>
    (getStakeRow.get(userId) as StakeRow | undefined) ?? { amount: 0, reward_debt: 0 };
  const pendingReward = (row: StakeRow, acc: number) =>
    Math.floor((row.amount * acc - row.reward_debt) / ACC_SCALE);

  /** Route a settled job's fee to stakers (called inside the settle txn). */
  function addStakingRewardRaw(fee: number) {
    if (fee <= 0) return;
    const s = stakeState();
    if (s.total_staked <= 0) return; // nothing staked → fee stays protocol margin
    const acc = s.acc_reward_per_share + (fee * ACC_SCALE) / s.total_staked;
    updStakeState.run(s.total_staked, acc, s.lifetime_rewards + fee);
  }

  /** Pay out a user's pending rewards to their spendable balance (inside a txn). */
  function payPending(userId: string, acc: number, row: StakeRow): number {
    const pending = pendingReward(row, acc);
    if (pending > 0) {
      insLedger.run(randomUUID(), userId, pending, "stake_reward", "earn", "stake", now());
    }
    return Math.max(0, pending);
  }

  /** Create the user on first sight and grant the signup credits exactly once. */
  const ensureUser = db.transaction((userId: string, displayName?: string, isWorker = false) => {
    const existing = getUser.get(userId);
    if (existing) return existing;
    insUser.run(userId, displayName ?? null, isWorker ? 1 : 0, now());
    if (!isWorker && signupGrant > 0) {
      insLedger.run(randomUUID(), userId, signupGrant, "grant", "grant", "signup", now());
    }
    return getUser.get(userId);
  });

  /**
   * Atomically check balance and reserve credits for a job. The check and the
   * insert happen in ONE synchronous transaction, so two concurrent jobs can
   * never both pass the balance check and overspend.
   */
  const reserve = db.transaction((userId: string, jobId: string, amount: number, model: string) => {
    const bal = balanceOf(userId);
    if (bal < amount) throw new InsufficientCreditsError(bal, amount);
    insLedger.run(randomUUID(), userId, -amount, "reserve", "system", jobId, now());
    insJob.run(jobId, userId, model, "reserved", amount, now(), now());
    return balanceOf(userId);
  });

  /**
   * Settle a finished job: turn the reservation into the real charge, pay the
   * worker its earn share, and mark the job done — all atomically.
   */
  const settle = db.transaction(
    (
      userId: string,
      jobId: string,
      reserveAmount: number,
      model: string,
      usage: { promptTokens: number; completionTokens: number },
      servedBy: string,
      fixedCharge?: number,
    ): SettleResult => {
      const charge = fixedCharge ?? settleCost(model, usage);
      // route a slice of the charge to stakers (from protocol margin)
      addStakingRewardRaw(stakingFee(charge));
      // reservation removed `reserveAmount`; correct it so net spend == charge.
      const correction = reserveAmount - charge; // >0 => refund some back
      if (correction !== 0) {
        insLedger.run(randomUUID(), userId, correction, "settle", "system", jobId, now());
      }
      const earn = workerEarn(charge);
      if (earn > 0 && servedBy) {
        insUser.run(servedBy, servedBy, 1, now());
        insLedger.run(randomUUID(), servedBy, earn, "earn", "earn", jobId, now());
      }
      updJob.run("done", charge, usage.promptTokens, usage.completionTokens, servedBy, now(), jobId);
      return { charge, balance: balanceOf(userId), earn };
    },
  );

  const findDeposit = db.prepare(
    "SELECT id FROM ledger_entries WHERE ref = ? AND source = 'deposit_eth' LIMIT 1",
  );

  /**
   * Credit a verified on-chain ETH or USDT deposit. Idempotent: a transaction
   * hash is unique on-chain and can only ever credit once, so replaying the same
   * hash is a no-op. Runs in one synchronous transaction.
   */
  const creditDeposit = db.transaction((userId: string, credits: number, txHash: string) => {
    const ref = txHash.toLowerCase();
    if (findDeposit.get(ref)) {
      return { credited: false, balance: balanceOf(userId) };
    }
    insUser.run(userId, userId, 0, now());
    insLedger.run(randomUUID(), userId, credits, "purchase", "deposit_eth", ref, now());
    return { credited: true, balance: balanceOf(userId) };
  });

  const maxDepositIndex = db.prepare("SELECT MAX(deposit_index) AS m FROM users");
  const setDepositIndex = db.prepare("UPDATE users SET deposit_index = ? WHERE id = ?");

  /**
   * The user's BIP-44 address index, assigned on first request. Allocating inside
   * a transaction is what stops two concurrent callers taking the same index and
   * therefore sharing a deposit address.
   */
  const depositIndexFor = db.transaction((userId: string): number => {
    insUser.run(userId, userId, 0, now());
    const existing = (getUser.get(userId) as { deposit_index?: number | null } | undefined)
      ?.deposit_index;
    if (typeof existing === "number") return existing;
    const next = (((maxDepositIndex.get() as { m: number | null }).m) ?? -1) + 1;
    setDepositIndex.run(next, userId);
    return next;
  });

  /** Lock credits into a stake, settling any pending rewards first. */
  const stake = db.transaction((userId: string, amount: number) => {
    if (amount <= 0) throw new Error("amount must be positive");
    const bal = balanceOf(userId);
    if (bal < amount) throw new InsufficientCreditsError(bal, amount);
    const s = stakeState();
    const row = stakeRow(userId);
    payPending(userId, s.acc_reward_per_share, row);
    insLedger.run(randomUUID(), userId, -amount, "stake", "system", "stake", now());
    const newAmount = row.amount + amount;
    upsStake.run(userId, newAmount, newAmount * s.acc_reward_per_share, now());
    updStakeState.run(s.total_staked + amount, s.acc_reward_per_share, s.lifetime_rewards);
    return { staked: newAmount, balance: balanceOf(userId) };
  });

  /** Withdraw credits from a stake, settling pending rewards first. */
  const unstake = db.transaction((userId: string, amount: number) => {
    if (amount <= 0) throw new Error("amount must be positive");
    const s = stakeState();
    const row = stakeRow(userId);
    if (row.amount < amount) throw new Error("not enough staked");
    payPending(userId, s.acc_reward_per_share, row);
    insLedger.run(randomUUID(), userId, amount, "unstake", "system", "stake", now());
    const newAmount = row.amount - amount;
    upsStake.run(userId, newAmount, newAmount * s.acc_reward_per_share, now());
    updStakeState.run(s.total_staked - amount, s.acc_reward_per_share, s.lifetime_rewards);
    return { staked: newAmount, balance: balanceOf(userId) };
  });

  /** Pay out pending staking rewards without changing the stake. */
  const claimStake = db.transaction((userId: string) => {
    const s = stakeState();
    const row = stakeRow(userId);
    const claimed = payPending(userId, s.acc_reward_per_share, row);
    upsStake.run(userId, row.amount, row.amount * s.acc_reward_per_share, now());
    return { claimed, balance: balanceOf(userId) };
  });

  /**
   * Request a withdrawal: enforce min/per-request/daily caps, deduct credits, and
   * create a 'requested' row — all atomically. The payout is sent afterward.
   */
  const requestWithdrawal = db.transaction(
    (
      userId: string,
      credits: number,
      address: string,
      caps: { min: number; maxPerRequest: number; maxPerDay: number },
      payout: { amount: number; currency: string },
    ): WithdrawalRow => {
      if (!Number.isInteger(credits) || credits <= 0) throw new WithdrawalError("invalid amount");
      if (credits < caps.min) throw new WithdrawalError(`minimum withdrawal is ${caps.min} credits`);
      if (credits > caps.maxPerRequest)
        throw new WithdrawalError(`maximum per withdrawal is ${caps.maxPerRequest} credits`);
      if (!(payout.amount > 0)) throw new WithdrawalError("payout amount unavailable (price feed?)");
      const bal = balanceOf(userId);
      if (bal < credits) throw new InsufficientCreditsError(bal, credits);
      const cashable = withdrawableOf(userId);
      if (cashable < credits) {
        throw new WithdrawalError(
          `only ${cashable} credits are withdrawable (deposits + earnings); promotional credits can be spent but not cashed out`,
        );
      }
      const startOfDay = Math.floor(now() / 86_400_000) * 86_400_000;
      const today = (withdrawnTodaySum.get(userId, startOfDay) as { s: number }).s;
      if (today + credits > caps.maxPerDay)
        throw new WithdrawalError(`daily limit is ${caps.maxPerDay} credits (already ${today} today)`);

      const id = randomUUID();
      insLedger.run(randomUUID(), userId, -credits, "withdraw", "system", id, now());
      insWithdrawal.run(id, userId, credits, payout.amount, payout.currency, address, now(), now());
      return getWithdrawal.get(id) as WithdrawalRow;
    },
  );

  const markWithdrawalPaid = db.transaction((id: string, signature: string) => {
    updWithdrawal.run("paid", signature, null, now(), id);
  });

  /** Mark failed. Refund credits ONLY when no payout was submitted on-chain. */
  const markWithdrawalFailed = db.transaction((id: string, error: string, refundCredits: boolean) => {
    const w = getWithdrawal.get(id) as WithdrawalRow | undefined;
    if (!w) return;
    if (refundCredits) {
      insLedger.run(randomUUID(), w.user_id, w.credits, "withdraw_refund", "system", id, now());
      updWithdrawal.run("failed", null, error, now(), id);
    } else {
      // payout may have landed — do NOT refund; flag for manual review
      updWithdrawal.run("review", w.signature, error, now(), id);
    }
  });

  /** Job failed: give the full reservation back, no charge. */
  const refund = db.transaction((userId: string, jobId: string, reserveAmount: number) => {
    insLedger.run(randomUUID(), userId, reserveAmount, "refund", "system", jobId, now());
    updJob.run("error", 0, 0, 0, null, now(), jobId);
    return balanceOf(userId);
  });

  return {
    raw: db,
    ensureUser,
    balanceOf,
    withdrawableOf,
    /** Optional wallet linked to an account (proven by signature). */
    walletOf: (userId: string) => ((getUser.get(userId) as any)?.wallet as string | null) ?? null,
    // lowercased: EIP-55 checksum casing is cosmetic, and x_links joins on this
    setWallet: (userId: string, wallet: string | null) =>
      setUserWallet.run(wallet ? wallet.toLowerCase() : null, userId),
    depositIndexFor,
    reserve,
    settle,
    refund,
    creditDeposit,
    requestWithdrawal,
    markWithdrawalPaid,
    markWithdrawalFailed,
    setWithdrawalSignature: (id: string, signature: string) =>
      updWithdrawal.run("requested", signature, null, now(), id),
    getWithdrawal: (id: string) => getWithdrawal.get(id) as WithdrawalRow | undefined,
    listWithdrawals: (userId: string, limit = 25) => withdrawalsList.all(userId, limit) as WithdrawalRow[],
    /** Persisted settings (used for the attestation signing key). */
    getSetting: (key: string): string | null =>
      (getSetting.get(key) as { value: string } | undefined)?.value ?? null,
    setSetting: (key: string, value: string) => setSetting.run(key, value),

    saveAttestation: (a: {
      runId: string; projectId: string; prompt: string; promptSha256: string;
      verified: boolean; signature: string; publicKey: string; transcriptUrl?: string; createdAt: number;
    }) => insAttest.run(a.runId, a.projectId, a.prompt, a.promptSha256, a.verified ? 1 : 0, a.signature, a.publicKey, a.transcriptUrl ?? null, a.createdAt),
    getAttestation: (runId: string) => (getAttest.get(runId) as any) ?? null,
    /** Stamp pre-rotation records with the key that actually signed them. */
    backfillAttestationKey: (publicKey: string) =>
      db.prepare("UPDATE attestations SET public_key = ? WHERE public_key IS NULL").run(publicKey).changes,
    listAttestations: (limit = 20) => listAttest.all(limit) as any[],

    /** Aristotle project for a chat conversation (null = start a new thread). */
    aristotleProjectFor: (userId: string, conversationId: string): string | null =>
      (getAristotleProject.get(userId, conversationId) as { project_id: string } | undefined)?.project_id ?? null,
    rememberAristotleProject: (userId: string, conversationId: string, projectId: string) =>
      setAristotleProject.run(userId, conversationId, projectId, now()),

    // --- X bot ---
    createXLinkCode: (code: string, userId: string, wallet: string) => {
      insXLink.run(code, userId, wallet, now());
      return getXLinkByCode.get(code) as XLinkRow;
    },
    /** Bind a code to the X handle that tweeted it. Idempotent + single-use. */
    verifyXLinkCode: db.transaction((code: string, rawHandle: string) => {
      // X handles are case-insensitive; normalise so lookups can't miss.
      const handle = String(rawHandle).replace(/^@/, "").toLowerCase();
      const row = getXLinkByCode.get(code) as XLinkRow | undefined;
      if (!row) return { ok: false as const, error: "unknown code" };
      if (row.verified) {
        return row.x_handle?.toLowerCase() === handle.toLowerCase()
          ? { ok: true as const, row, already: true }
          : { ok: false as const, error: "code already used by another account" };
      }
      verifyXLink.run(handle, now(), code);
      return { ok: true as const, row: getXLinkByCode.get(code) as XLinkRow, already: false };
    }),
    xLinkForHandle: (handle: string) =>
      (getXLinkByHandle.get(String(handle).replace(/^@/, "").toLowerCase()) as XLinkRow | undefined) ?? null,
    xLinkForUser: (userId: string) => (getXLinkByUser.get(userId) as XLinkRow | undefined) ?? null,
    xCursor: () => (getXCursor.get() as { last_mention_id: string | null }).last_mention_id,
    setXCursor: (id: string) => setXCursor.run(id),
    xRequestSeen: (tweetId: string) => !!getXRequest.get(tweetId),
    logXRequest: (tweetId: string, handle: string, command: string, status: string, detail?: string) =>
      insXRequest.run(tweetId, String(handle).replace(/^@/, "").toLowerCase(), command, status, detail ?? null, now()),
    updateXRequest: (tweetId: string, status: string, detail?: string) =>
      updXRequest.run(status, detail ?? null, tweetId),
    xRequestsToday: (handle: string) => {
      const startOfDay = Math.floor(now() / 86_400_000) * 86_400_000;
      const h = String(handle).replace(/^@/, "").toLowerCase();
      return (countXToday.get(h, startOfDay) as { n: number }).n;
    },

    stake,
    unstake,
    claimStake,
    stakeInfo: (userId: string) => {
      const s = stakeState();
      const row = stakeRow(userId);
      return {
        staked: row.amount,
        pending: Math.max(0, pendingReward(row, s.acc_reward_per_share)),
        totalStaked: s.total_staked,
        lifetimeRewards: s.lifetime_rewards,
      };
    },
    ledgerHistory: (userId: string, limit = 50) => ledgerHistory.all(userId, limit) as LedgerRow[],

    // --- comms ---
    publishKey: (userId: string, publicKey: string) => upsKey.run(userId, publicKey, now()),
    getPublicKey: (userId: string): string | null => {
      const row = getKey.get(userId) as { public_key: string } | undefined;
      return row?.public_key ?? null;
    },
    storeMessage: (m: {
      fromUser: string;
      toUser: string;
      ciphertext: string;
      nonce: string;
      epk: string;
    }) => {
      const id = randomUUID();
      const ts = now();
      insMsg.run(id, m.fromUser, m.toUser, m.ciphertext, m.nonce, m.epk, ts);
      return { id, ts };
    },
    takeUndelivered: (userId: string) => {
      const rows = getUndelivered.all(userId) as Array<{
        id: string;
        from_user: string;
        to_user: string;
        ciphertext: string;
        nonce: string;
        epk: string;
        ts: number;
      }>;
      for (const r of rows) markDelivered.run(r.id);
      return rows;
    },
  };
}

export type Db = ReturnType<typeof createDb>;
