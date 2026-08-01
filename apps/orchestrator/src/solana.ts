import { Connection, PublicKey } from "@solana/web3.js";

/** USDC SPL mint (mainnet-beta). Devnet USDC uses a different mint; overridable via env. */
export const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export interface SolanaConfig {
  enabled: boolean;
  cluster: string;
  rpcUrl: string;
  treasury: string;
  solUsdPrice: number;
  usdcMint: string;
}

export interface DepositResult {
  lamports: number;
  sol: number;
  credits: number;
  sender: string | null;
}

/** Result of a verified deposit in either currency. */
export interface VerifyResult {
  credits: number;
  currency: "SOL" | "USDC";
  amount: number;
  sender: string | null;
}

interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { uiAmount: number | null; amount: string; decimals: number };
}

/** Net USDC (uiAmount) received by the treasury in a tx, from pre/post token balances. */
export function usdcDelta(
  pre: TokenBalance[],
  post: TokenBalance[],
  treasury: string,
  mint: string,
): number {
  const match = (e: TokenBalance) => e.owner === treasury && e.mint === mint;
  const preByIdx = new Map(pre.filter(match).map((e) => [e.accountIndex, e.uiTokenAmount.uiAmount ?? 0]));
  let delta = 0;
  for (const e of post.filter(match)) {
    delta += (e.uiTokenAmount.uiAmount ?? 0) - (preByIdx.get(e.accountIndex) ?? 0);
  }
  return delta;
}

function extractMemo(instructions: any[]): string | null {
  for (const ix of instructions) {
    if (ix?.program === "spl-memo") return typeof ix.parsed === "string" ? ix.parsed : String(ix.parsed ?? "");
  }
  return null;
}

/**
 * Verifies a Solana deposit transaction ON-CHAIN and converts it to credits.
 * Non-custodial: the treasury only receives. We require the tx to (a) transfer
 * SOL to our treasury and (b) carry a memo `0c:<userId>` binding the payment to
 * the paying user — so a signature can't be claimed by someone else. Idempotency
 * (one credit per signature) is enforced by the DB layer.
 */
/**
 * Pure validation of an already-fetched parsed transaction — no network. This is
 * the security core (memo binding + treasury destination + credit math) and is
 * unit-testable in isolation.
 */
export function interpretParsedTx(
  instructions: any[],
  errored: boolean,
  cfg: Pick<SolanaConfig, "treasury" | "solUsdPrice">,
  userId: string,
): DepositResult {
  if (errored) throw new Error("transaction failed on-chain");

  let lamports = 0;
  let memo: string | null = null;
  let sender: string | null = null;

  for (const ix of instructions) {
    if (!ix || !("parsed" in ix)) continue;
    if (ix.program === "system" && ix.parsed?.type === "transfer") {
      const info = ix.parsed.info;
      if (info?.destination === cfg.treasury) {
        lamports += Number(info.lamports);
        sender = info.source ?? sender;
      }
    }
    if (ix.program === "spl-memo") {
      memo = typeof ix.parsed === "string" ? ix.parsed : String(ix.parsed ?? "");
    }
  }

  if (lamports <= 0) throw new Error("no SOL transfer to the treasury in this transaction");
  if (memo !== `0c:${userId}`) {
    throw new Error("deposit memo does not match your account — did you deposit from this account?");
  }

  const sol = lamports / 1e9;
  const credits = Math.floor(sol * cfg.solUsdPrice * 100); // 1 credit = $0.01
  if (credits <= 0) throw new Error("deposit too small to credit");

  return { lamports, sol, credits, sender };
}

export function makeSolana(cfg: SolanaConfig) {
  // On mainnet, require `finalized` so a credited deposit can never be on a tx
  // that gets rolled back. Devnet/testnet use `confirmed` for snappier tests.
  const commitment = cfg.cluster === "mainnet-beta" ? "finalized" : "confirmed";
  const connection = new Connection(cfg.rpcUrl, commitment);

  /**
   * Verify a deposit in SOL or USDC. Requires a memo `0c:<userId>` binding the
   * payment to the user. SOL is read from system-transfer instructions; USDC from
   * treasury token-balance deltas. `solUsdPrice` (live) prices SOL; USDC is 1:1.
   */
  async function verifyDeposit(
    signature: string,
    userId: string,
    solUsdPrice: number,
  ): Promise<VerifyResult> {
    const tx = await connection.getParsedTransaction(signature, {
      commitment,
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) throw new Error("transaction not found or not yet confirmed — try again in a moment");
    if (tx.meta?.err) throw new Error("transaction failed on-chain");

    const ixs = tx.transaction.message.instructions as any[];
    const memo = extractMemo(ixs);
    if (memo !== `0c:${userId}`) {
      throw new Error("deposit memo does not match your account — did you deposit from this account?");
    }

    // SOL
    let lamports = 0;
    let sender: string | null = null;
    for (const ix of ixs) {
      if (ix?.program === "system" && ix.parsed?.type === "transfer" && ix.parsed.info?.destination === cfg.treasury) {
        lamports += Number(ix.parsed.info.lamports);
        sender = ix.parsed.info.source ?? sender;
      }
    }
    if (lamports > 0) {
      const sol = lamports / 1e9;
      const credits = Math.floor(sol * solUsdPrice * 100);
      if (credits <= 0) throw new Error("deposit too small to credit");
      return { credits, currency: "SOL", amount: sol, sender };
    }

    // USDC (1 USDC = $1 = 100 credits)
    const usdc = usdcDelta(
      (tx.meta?.preTokenBalances as any) ?? [],
      (tx.meta?.postTokenBalances as any) ?? [],
      cfg.treasury,
      cfg.usdcMint,
    );
    if (usdc > 0) {
      const credits = Math.floor(usdc * 100);
      if (credits <= 0) throw new Error("deposit too small to credit");
      return { credits, currency: "USDC", amount: usdc, sender };
    }

    throw new Error("no SOL or USDC transfer to the treasury in this transaction");
  }

  return { verifyDeposit, connection };
}

/** Validate a base58 pubkey at boot so misconfig fails loudly. */
export function isValidPubkey(s: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}
