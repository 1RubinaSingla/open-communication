import { ROOT } from "./load-env.js"; // must be first: populates process.env
import { resolve as resolvePath, join as joinPath } from "node:path";
import { createReadStream, existsSync as fileExists, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { timingSafeEqual } from "node:crypto";
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519";
import Database from "better-sqlite3";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { Server as IOServer } from "socket.io";
import {
  COMMS_NS,
  DmSend,
  Ev,
  HandshakeAuth,
  INFER_NS,
  JobSubmit,
  KeyFetch,
  KeyPublish,
  WorkerRegister,
} from "@0c/protocol";
import { createDb } from "@0c/db";
import {
  ARISTOTLE_CREDITS,
  ARISTOTLE_MODEL,
  ARISTOTLE_TRIVIAL_CREDITS,
  creditsToUsd,
  estimateTokens,
} from "@0c/credits";
import { makeAuth } from "./auth.js";
import { makeSolana, isValidPubkey, USDC_MINT_MAINNET } from "./solana.js";
import { makePrice } from "./price.js";
import { makePayout } from "./payout.js";
import { ConnectionRegistry, WorkerRegistry } from "./registry.js";
import { InferenceEngine, type JobSink } from "./engine.js";
import { AgentEngine } from "./agent.js";
import { aristotle, searchProvider, trivialMath, verifiedMathEnabled } from "./tools.js";
import { aristotleTranscriptUrl } from "./aristotle.js";
import { makeAttestor } from "./attest.js";
import { newRunId, runMarker } from "@0c/crypto/attest";

import { gateConfigFromEnv, makeTokenGate } from "./tokengate.js";
import { LINK_PREFIX, newLinkCode, xbotConfigFromEnv } from "./xbot.js";

/** Operator-tunable price for a verified-math run (minutes of proof-agent time). */
const aristotleCredits = Number(process.env.ARISTOTLE_CREDITS ?? ARISTOTLE_CREDITS);
const tokenGate = makeTokenGate(gateConfigFromEnv());
const xbotCfg = xbotConfigFromEnv();

// Railway/Render/Fly inject PORT; fall back to ORCH_PORT locally.
const PORT = Number(process.env.PORT ?? process.env.ORCH_PORT ?? 4000);
const HOST = process.env.ORCH_HOST ?? "0.0.0.0";
const SECRET = process.env.ORCH_SECRET ?? "dev-secret-change-me";
const DB_PATH = resolvePath(ROOT, process.env.DB_PATH ?? "./data/0c.sqlite");
const SIGNUP_GRANT = Number(process.env.SIGNUP_GRANT_CREDITS ?? 500);

const TREASURY = process.env.TREASURY_ADDRESS ?? "";
const solanaCfg = {
  enabled: process.env.DEPOSITS_ENABLED === "true" && isValidPubkey(TREASURY),
  cluster: process.env.SOLANA_CLUSTER ?? "devnet",
  rpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
  treasury: TREASURY,
  solUsdPrice: Number(process.env.SOL_USD_PRICE ?? 150),
  usdcMint: process.env.USDC_MINT ?? USDC_MINT_MAINNET,
};
const solana = makeSolana(solanaCfg);
const price = makePrice(solanaCfg.solUsdPrice);

// --- Withdrawals (opt-in; needs the treasury private key) ---
const withdrawCaps = {
  min: Number(process.env.WITHDRAW_MIN ?? 100), // $1
  maxPerRequest: Number(process.env.WITHDRAW_MAX_REQUEST ?? 5000), // $50
  maxPerDay: Number(process.env.WITHDRAW_MAX_DAY ?? 20000), // $200
};
let withdrawEnabled = process.env.WITHDRAWALS_ENABLED === "true" && !!process.env.TREASURY_SECRET_KEY && solanaCfg.enabled;
let payout: ReturnType<typeof makePayout> | null = null;
if (withdrawEnabled) {
  try {
    payout = makePayout({
      rpcUrl: solanaCfg.rpcUrl,
      cluster: solanaCfg.cluster,
      usdcMint: solanaCfg.usdcMint,
      secretKey: process.env.TREASURY_SECRET_KEY!,
    });
    if (payout.treasuryPubkey !== solanaCfg.treasury) {
      // safety: the signing key must control the configured treasury
      throw new Error(`TREASURY_SECRET_KEY pubkey ${payout.treasuryPubkey} != TREASURY_ADDRESS ${solanaCfg.treasury}`);
    }
  } catch (e) {
    withdrawEnabled = false;
    payout = null;
    console.error("[withdrawals] disabled:", e instanceof Error ? e.message : e);
  }
}

const db = createDb(DB_PATH, { signupGrant: SIGNUP_GRANT });
const auth = makeAuth(SECRET);
const attestor = makeAttestor(db, process.env.PUBLIC_DOMAIN ?? "opencommunication.app");
const workers = new WorkerRegistry();
const commsConns = new ConnectionRegistry();

const app = Fastify({ logger: { transport: undefined, level: "info" } });
await app.register(cors, { origin: true });

const io = new IOServer(app.server, { cors: { origin: true } });
const inferNs = io.of(INFER_NS);
const commsNs = io.of(COMMS_NS);
const engine = new InferenceEngine(db, workers, inferNs);
const agentEngine = new AgentEngine(db, workers, inferNs);

/**
 * Run a job against Harmonic's Aristotle (external, formally-verified math).
 * Reserves a flat cost, streams a "leaves the network" step, then settles or
 * refunds. Not served by a contributed GPU — this is an external oracle.
 */
async function runAristotleJob(
  userId: string,
  jobId: string,
  messages: any[],
  sink: JobSink,
  conversationId?: string,
) {
  const problem = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  // Pre-filter: plain arithmetic never reaches the proof agent — answer instantly
  // at the cheap rate instead of burning minutes of Aristotle time.
  const quick = trivialMath(problem);
  const cost = quick !== null ? ARISTOTLE_TRIVIAL_CREDITS : aristotleCredits;
  try {
    db.reserve(userId, jobId, cost, ARISTOTLE_MODEL);
  } catch (e) {
    sink.onError({ message: e instanceof Error ? e.message : "reserve failed", refunded: false });
    return;
  }
  if (quick !== null) {
    sink.onStep?.("↳ trivial arithmetic — answered locally, prompt never left the network");
    const text = `${quick}\n\n(computed locally; too simple to need formal verification)`;
    const usage = { promptTokens: estimateTokens(problem), completionTokens: estimateTokens(text) };
    const settled = db.settle(userId, jobId, cost, ARISTOTLE_MODEL, usage, "0c:local", cost);
    sink.onToken(0, text);
    sink.onDone({ usage, charge: settled.charge, balance: settled.balance, servedBy: "0c:local" });
    return;
  }

  sink.onStep?.("⚠ sending to Harmonic Aristotle — this prompt leaves the 0_C network");
  // Stamp the prompt with a run marker. It appears verbatim in the public
  // transcript, which is what lets anyone tie that transcript back to a signed
  // 0_C record (see /attest).
  const runId = newRunId();
  const markedPrompt = `${runMarker(runId, attestor.domain)}\n${problem}`;
  sink.onStep?.(`↳ run ${runId} — attested by ${attestor.domain}`);
  // Continue the same Aristotle project for follow-ups in this conversation, so
  // the agent reasons with full context instead of restarting each message.
  const priorProject = conversationId ? db.aristotleProjectFor(userId, conversationId) : null;
  const r = await aristotle.solve(markedPrompt, (p) => sink.onStep?.(`↳ ${p}`), priorProject ?? undefined);
  if (conversationId && r.projectId) db.rememberAristotleProject(userId, conversationId, r.projectId);
  if (!r.ok || !r.text) {
    db.refund(userId, jobId, cost);
    sink.onError({ message: r.error ?? "verified math failed", refunded: true });
    return;
  }
  sink.onStep?.(r.verified ? "✓ formally verified" : "↳ answered (unverified)");
  const transcriptUrl = r.projectId ? aristotleTranscriptUrl(r.projectId) : undefined;
  if (r.projectId) {
    attestor.record({ runId, projectId: r.projectId, prompt: markedPrompt, verified: !!r.verified, transcriptUrl });
    sink.onStep?.(`↳ signed attestation: /proof/${runId}`);
  }
  const usage = { promptTokens: estimateTokens(problem), completionTokens: estimateTokens(r.text) };
  const settled = db.settle(userId, jobId, cost, ARISTOTLE_MODEL, usage, "aristotle:harmonic", cost);
  sink.onToken(0, r.text);
  sink.onDone({
    usage,
    charge: settled.charge,
    balance: settled.balance,
    servedBy: "aristotle:harmonic",
    transcriptUrl,
    proofRunId: r.projectId ? runId : undefined,
  });
}

/* ============================ /infer ============================ */

inferNs.use((socket, next) => {
  const parsed = HandshakeAuth.safeParse(socket.handshake.auth);
  if (!parsed.success) return next(new Error("bad auth"));
  const a = parsed.data;
  if (a.kind === "worker") {
    // Native workers present the shared secret; browser contributors present a
    // normal user token (so we never ship the secret to every browser).
    if (a.workerSecret === SECRET) {
      socket.data.role = "worker";
      return next();
    }
    const wid = auth.verify(a.token);
    if (wid) {
      socket.data.role = "worker";
      socket.data.userId = wid;
      db.ensureUser(wid);
      return next();
    }
    return next(new Error("bad worker auth"));
  }
  const userId = auth.verify(a.token);
  if (!userId) return next(new Error("bad token"));
  socket.data.role = "user";
  socket.data.userId = userId;
  db.ensureUser(userId);
  next();
});

inferNs.on("connection", (socket) => {
  if (socket.data.role === "worker") {
    socket.on(Ev.workerRegister, (raw, ack?: (r: unknown) => void) => {
      const parsed = WorkerRegister.safeParse(raw);
      if (!parsed.success) return ack?.({ ok: false, error: "bad register" });
      workers.add(socket, parsed.data);
      app.log.info({ worker: parsed.data.name, models: parsed.data.models }, "worker registered");
      ack?.({ ok: true });
    });
    socket.on(Ev.workerHeartbeat, () => workers.touch(socket.id));
    socket.on(Ev.jobToken, (p: { jobId: string; delta: string }) =>
      engine.onWorkerToken(p.jobId, p.delta),
    );
    socket.on(Ev.jobMedia, (p: { jobId: string; mimeType: string; dataUrl: string }) =>
      engine.onWorkerMedia(p.jobId, p.mimeType, p.dataUrl),
    );
    socket.on(Ev.workerJobDone, (p: any) => engine.onWorkerDone(socket.id, p.jobId, p.usage, p.timing));
    socket.on(Ev.workerJobError, (p: any) => engine.onWorkerError(socket.id, p.jobId, p.message));
    socket.on("disconnect", () => {
      workers.remove(socket.id);
      engine.onWorkerGone(socket.id);
    });
    return;
  }

  // ---- user ----
  const userId = socket.data.userId as string;
  socket.on(Ev.jobSubmit, (raw, ack?: (r: unknown) => void) => {
    const parsed = JobSubmit.safeParse(raw);
    if (!parsed.success) return ack?.({ ok: false, error: "bad job" });
    const job = parsed.data;
    const sink: JobSink = {
      onToken: (seq, delta) => socket.emit(Ev.jobToken, { jobId: job.jobId, seq, delta }),
      onMedia: (mimeType, dataUrl) => socket.emit(Ev.jobMedia, { jobId: job.jobId, mimeType, dataUrl }),
      onStep: (text) => socket.emit(Ev.jobStep, { jobId: job.jobId, text }),
      onDone: (d) =>
        socket.emit(Ev.jobDone, {
          jobId: job.jobId,
          usage: d.usage,
          charge: d.charge,
          balance: d.balance,
          timing: d.timing,
          servedBy: d.servedBy,
          transcriptUrl: d.transcriptUrl,
          proofRunId: d.proofRunId,
        }),
      onError: (e) => socket.emit(Ev.jobError, { jobId: job.jobId, ...e }),
    };
    // External verified-math model — served by Harmonic's API, not by a worker.
    if (job.model === ARISTOTLE_MODEL) {
      ack?.({ ok: true, jobId: job.jobId, reservedCredits: aristotleCredits });
      void runAristotleJob(userId, job.jobId, job.messages, sink, job.conversationId);
      return;
    }
    if (job.kind === "agent") {
      ack?.({ ok: true, jobId: job.jobId, reservedCredits: 0 });
      void agentEngine.run({ userId, jobId: job.jobId, model: job.model, messages: job.messages, sink });
      return;
    }
    const res = engine.submit({
      userId,
      model: job.model,
      kind: job.kind,
      messages: job.messages,
      temperature: job.temperature,
      maxTokens: job.maxTokens,
      sink,
      jobId: job.jobId,
    });
    if (res.ok) ack?.({ ok: true, jobId: res.jobId, reservedCredits: res.reserved });
    else ack?.({ ok: false, error: res.error });
  });
});

/* ============================ /comms ============================ */

commsNs.use((socket, next) => {
  const parsed = HandshakeAuth.safeParse(socket.handshake.auth);
  if (!parsed.success) return next(new Error("bad auth"));
  const userId = auth.verify(parsed.data.token);
  if (!userId) return next(new Error("bad token"));
  socket.data.userId = userId;
  db.ensureUser(userId);
  next();
});

function deliverPending(userId: string) {
  if (!commsConns.isOnline(userId)) return;
  const rows = db.takeUndelivered(userId);
  for (const r of rows) {
    commsNs.to(userId).emit(Ev.dmRecv, {
      messageId: r.id,
      fromUserId: r.from_user,
      toUserId: r.to_user,
      ciphertext: r.ciphertext,
      nonce: r.nonce,
      epk: r.epk,
      ts: r.ts,
    });
  }
}

commsNs.on("connection", (socket) => {
  const userId = socket.data.userId as string;
  socket.join(userId);
  commsConns.add(userId, socket.id);
  deliverPending(userId);

  socket.on(Ev.keyPublish, (raw, ack?: (r: unknown) => void) => {
    const parsed = KeyPublish.safeParse(raw);
    if (!parsed.success) return ack?.({ ok: false, error: "bad key" });
    db.publishKey(userId, parsed.data.publicKey);
    ack?.({ ok: true });
  });

  socket.on(Ev.keyFetch, (raw, ack?: (r: unknown) => void) => {
    const parsed = KeyFetch.safeParse(raw);
    if (!parsed.success) return ack?.({ ok: false, error: "bad request" });
    const publicKey = db.getPublicKey(parsed.data.userId);
    if (!publicKey) return ack?.({ ok: false, error: "no key for user" });
    ack?.({ ok: true, userId: parsed.data.userId, publicKey });
  });

  socket.on(Ev.dmSend, (raw, ack?: (r: unknown) => void) => {
    const parsed = DmSend.safeParse(raw);
    if (!parsed.success) return ack?.({ ok: false, error: "bad message" });
    const m = parsed.data;
    const { id, ts } = db.storeMessage({
      fromUser: userId,
      toUser: m.toUserId,
      ciphertext: m.ciphertext,
      nonce: m.nonce,
      epk: m.epk,
    });
    ack?.({ ok: true, messageId: id, ts });
    deliverPending(m.toUserId);
  });

  socket.on(Ev.dmSync, (_raw, ack?: (r: unknown) => void) => {
    const rows = db.takeUndelivered(userId);
    ack?.({
      messages: rows.map((r) => ({
        messageId: r.id,
        fromUserId: r.from_user,
        toUserId: r.to_user,
        ciphertext: r.ciphertext,
        nonce: r.nonce,
        epk: r.epk,
        ts: r.ts,
      })),
    });
  });

  socket.on("disconnect", () => commsConns.remove(userId, socket.id));
});

/* ============================ REST ============================ */

app.get("/health", async () => ({ ok: true, workers: workers.size }));

app.get("/stats", async () => {
  const w = workers.stats();
  return {
    workers: w,
    workerCount: w.length,
    online: w.filter((x) => !x.busy).length,
    totalTokensPerSec: w.reduce((n, x) => n + x.tokensPerSec, 0),
    searchProvider: searchProvider(),
    verifiedMath: verifiedMathEnabled(),
  };
});

/** Dev login: ensure the user, mint a signed token, return the current balance. */
app.post("/auth/dev", async (req) => {
  const body = (req.body ?? {}) as { userId?: string };
  const userId = (body.userId ?? "").trim();
  if (!userId) return { ok: false, error: "userId required" };
  db.ensureUser(userId);
  return { ok: true, userId, token: auth.sign(userId), balance: db.balanceOf(userId) };
});

function bearer(req: { headers: Record<string, unknown> }): string | null {
  const h = (req.headers["authorization"] as string | undefined) ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

app.get("/me", async (req, reply) => {
  const userId = auth.verify(bearer(req) ?? undefined);
  if (!userId) return reply.code(401).send({ error: "unauthorized" });
  const balance = db.balanceOf(userId);
  return {
    userId,
    balance,
    usd: creditsToUsd(balance),
    withdrawable: db.withdrawableOf(userId),
    wallet: db.walletOf(userId),
  };
});

app.get("/ledger", async (req, reply) => {
  const userId = auth.verify(bearer(req) ?? undefined);
  if (!userId) return reply.code(401).send({ error: "unauthorized" });
  return { entries: db.ledgerHistory(userId, 50) };
});

/** Public deposit config so the wallet UI knows where to pay + at what rate. */
app.get("/credits/config", async () => {
  const solUsdPrice = await price.getSolUsd();
  return {
    enabled: solanaCfg.enabled,
    cluster: solanaCfg.cluster,
    treasury: solanaCfg.treasury,
    solUsdPrice,
    priceSource: price.priceSource(),
    priceLive: true,
    usdcMint: solanaCfg.usdcMint,
    currencies: ["SOL", "USDC"],
    memoPrefix: "0c:",
  };
});

/** Verify a SOL deposit on-chain and credit the user. Idempotent by signature. */
app.post("/credits/deposit", async (req, reply) => {
  const userId = auth.verify(bearer(req) ?? undefined);
  if (!userId) return reply.code(401).send({ error: "unauthorized" });
  if (!solanaCfg.enabled) return reply.code(400).send({ error: "deposits are not enabled" });
  const body = (req.body ?? {}) as { signature?: string };
  const signature = (body.signature ?? "").trim();
  if (!signature) return reply.code(400).send({ error: "signature required" });

  db.ensureUser(userId);
  try {
    const solUsdPrice = await price.getSolUsd();
    const result = await solana.verifyDeposit(signature, userId, solUsdPrice);
    const credit = db.creditDeposit(userId, result.credits, signature);
    app.log.info(
      { userId, signature, credits: result.credits, amount: result.amount, currency: result.currency, credited: credit.credited },
      "solana deposit",
    );
    return {
      ok: true,
      credited: credit.credited,
      credits: result.credits,
      amount: result.amount,
      currency: result.currency,
      balance: credit.balance,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "verification failed";
    return reply.code(400).send({ error: message });
  }
});

/**
 * Download a consistent snapshot of the database. The volume holding the ledger
 * has no redundancy, so pull this off-site regularly.
 *
 *   curl -H "x-admin-secret: $ORCH_SECRET" <orch>/admin/backup -o 0c-backup.sqlite
 */
app.get("/admin/backup", async (req, reply) => {
  const provided = String((req.headers["x-admin-secret"] as string) ?? "");
  const expected = SECRET;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  if (!fileExists(DB_PATH)) return reply.code(500).send({ error: "database not found" });

  const tmp = joinPath(tmpdir(), `0c-backup-${Date.now()}.sqlite`);
  try {
    const snap = new Database(DB_PATH, { readonly: true });
    snap.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    snap.close();
  } catch (e) {
    return reply.code(500).send({ error: e instanceof Error ? e.message : "snapshot failed" });
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  reply.header("content-type", "application/octet-stream");
  reply.header("content-disposition", `attachment; filename="0c-${stamp}.sqlite"`);
  reply.header("content-length", String(statSync(tmp).size));
  const stream = createReadStream(tmp);
  stream.on("close", () => { try { unlinkSync(tmp); } catch { /* already gone */ } });
  return reply.send(stream);
});

/* ---- optional wallet link (proven by signature) ---- */
const WALLET_CHALLENGE_TTL_MS = 5 * 60_000;

/** The exact message the wallet must sign. Server-dictated to avoid ambiguity. */
function walletChallenge(userId: string, issuedAt: number) {
  return [
    "Open Communication — link wallet",
    `account: ${userId}`,
    `issued: ${new Date(issuedAt).toISOString()}`,
    "Signing proves you control this wallet. It authorises no transaction.",
  ].join("\n");
}

app.get("/me/wallet/challenge", async (req, reply) => {
  const userId = auth.verify(bearer(req) ?? undefined);
  if (!userId) return reply.code(401).send({ error: "unauthorized" });
  const issuedAt = Date.now();
  return { message: walletChallenge(userId, issuedAt), issuedAt, expiresInMs: WALLET_CHALLENGE_TTL_MS };
});

app.post("/me/wallet", async (req, reply) => {
  const userId = auth.verify(bearer(req) ?? undefined);
  if (!userId) return reply.code(401).send({ error: "unauthorized" });
  const body = (req.body ?? {}) as { wallet?: string; signature?: string; issuedAt?: number };
  const wallet = String(body.wallet ?? "").trim();
  const signature = String(body.signature ?? "").trim();
  const issuedAt = Number(body.issuedAt ?? 0);

  if (!isValidPubkey(wallet)) return reply.code(400).send({ error: "invalid Solana address" });
  if (!signature) return reply.code(400).send({ error: "signature required" });
  if (!issuedAt || Math.abs(Date.now() - issuedAt) > WALLET_CHALLENGE_TTL_MS) {
    return reply.code(400).send({ error: "challenge expired — try again" });
  }

  // The signature must be over OUR message for THIS account, by THIS wallet.
  let ok = false;
  try {
    ok = ed25519.verify(
      bs58.decode(signature),
      new TextEncoder().encode(walletChallenge(userId, issuedAt)),
      bs58.decode(wallet),
    );
  } catch {
    ok = false;
  }
  if (!ok) return reply.code(400).send({ error: "signature does not match this wallet" });

  db.ensureUser(userId);
  db.setWallet(userId, wallet);
  app.log.info({ userId, wallet }, "wallet linked");
  return { ok: true, wallet };
});

app.delete("/me/wallet", async (req, reply) => {
  const userId = auth.verify(bearer(req) ?? undefined);
  if (!userId) return reply.code(401).send({ error: "unauthorized" });
  db.setWallet(userId, null);
  return { ok: true };
});

/* ---- public provenance attestations ---- */
/** The published key anyone uses to verify our signatures. */
app.get("/attest/key", async () => ({
  algorithm: "ed25519",
  format: "0c-attest-v1",
  publicKey: attestor.publicKeyHex,
  domain: attestor.domain,
}));

app.get("/attest", async () => ({
  attestations: db.listAttestations(20).map((a: any) => ({
    runId: a.run_id,
    projectId: a.project_id,
    verified: !!a.verified,
    createdAt: a.created_at,
  })),
}));

/** Full signed record for one run — everything needed to verify independently. */
app.get("/attest/:runId", async (req, reply) => {
  const runId = String((req.params as any).runId ?? "");
  const a = db.getAttestation(runId);
  if (!a) return reply.code(404).send({ error: "unknown run" });
  return {
    runId: a.run_id,
    projectId: a.project_id,
    prompt: a.prompt,
    promptSha256: a.prompt_sha256,
    verified: !!a.verified,
    createdAt: a.created_at,
    signature: a.signature,
    transcriptUrl: a.transcript_url,
    // the key that signed THIS record, so rotating keys never breaks old proofs
    publicKey: a.public_key ?? attestor.publicKeyHex,
    currentPublicKey: attestor.publicKeyHex,
    algorithm: "ed25519",
    format: "0c-attest-v1",
  };
});

/* ---- X bot: wallet <-> X handle linking + holder status ---- */
app.get("/x/config", async () => ({
  enabled: xbotCfg.enabled,
  handle: xbotCfg.handle,
  gateConfigured: tokenGate.configured,
  tier1Tokens: tokenGate.cfg.tier1,
  tier2Tokens: tokenGate.cfg.tier2,
  tier1DailyLimit: tokenGate.cfg.tier1DailyLimit,
  linkPrefix: LINK_PREFIX,
}));

/** Issue a one-time code the user tweets to prove they control the X account. */
app.post("/x/link/start", async (req, reply) => {
  const userId = auth.verify(bearer(req) ?? undefined);
  if (!userId) return reply.code(401).send({ error: "unauthorized" });
  const wallet = String((req.body as any)?.wallet ?? "").trim();
  if (!isValidPubkey(wallet)) return reply.code(400).send({ error: "invalid Solana address" });
  db.ensureUser(userId);
  const row = db.createXLinkCode(newLinkCode(), userId, wallet);
  return {
    ok: true,
    code: row.code,
    instructions: `Tweet "${row.code}" (mentioning @${xbotCfg.handle || "the bot"}) to link this wallet to your X account.`,
  };
});

/** Current link + holder tier for the signed-in user. */
app.get("/x/link/status", async (req, reply) => {
  const userId = auth.verify(bearer(req) ?? undefined);
  if (!userId) return reply.code(401).send({ error: "unauthorized" });
  const link = db.xLinkForUser(userId);
  if (!link) return { linked: false };
  const gate = link.verified ? await tokenGate.check(link.wallet) : null;
  return {
    linked: !!link.verified,
    code: link.code,
    wallet: link.wallet,
    xHandle: link.x_handle,
    tier: gate?.tier ?? "none",
    balance: gate?.balance ?? 0,
    dailyLimit: gate?.dailyLimit ?? 0,
  };
});

/* ---- withdrawals (credits -> USDC) ---- */
app.get("/withdrawals/config", async () => ({
  enabled: withdrawEnabled,
  currency: "SOL",
  min: withdrawCaps.min,
  maxPerRequest: withdrawCaps.maxPerRequest,
  maxPerDay: withdrawCaps.maxPerDay,
  solUsdPrice: await price.getSolUsd(),
}));

app.get("/withdrawals", async (req, reply) => {
  const userId = auth.verify(bearer(req) ?? undefined);
  if (!userId) return reply.code(401).send({ error: "unauthorized" });
  return { withdrawals: db.listWithdrawals(userId, 25), withdrawable: db.withdrawableOf(userId) };
});

app.post("/withdrawals", async (req, reply) => {
  const userId = auth.verify(bearer(req) ?? undefined);
  if (!userId) return reply.code(401).send({ error: "unauthorized" });
  if (!withdrawEnabled || !payout) return reply.code(400).send({ error: "withdrawals are not enabled" });
  const body = (req.body ?? {}) as { credits?: number; address?: string };
  const credits = Math.floor(Number(body.credits ?? 0));
  const address = String(body.address ?? "").trim();
  if (!isValidPubkey(address)) return reply.code(400).send({ error: "invalid Solana address" });

  db.ensureUser(userId);
  const solUsdPrice = await price.getSolUsd();
  const solAmount = solUsdPrice > 0 ? creditsToUsd(credits) / solUsdPrice : 0;
  let w;
  try {
    w = db.requestWithdrawal(userId, credits, address, withdrawCaps, { amount: solAmount, currency: "SOL" });
  } catch (e) {
    return reply.code(400).send({ error: e instanceof Error ? e.message : "request failed" });
  }

  // automatic payout (within caps enforced above)
  const result = await payout.paySol(address, w.amount, (sig) => db.setWithdrawalSignature(w!.id, sig));
  if (result.signature && !result.error) {
    db.markWithdrawalPaid(w.id, result.signature);
    app.log.info({ userId, id: w.id, sol: w.amount, sig: result.signature }, "withdrawal paid");
    return { ok: true, status: "paid", signature: result.signature, amount: w.amount, currency: "SOL", credits, balance: db.balanceOf(userId) };
  }
  // refund only if nothing was submitted on-chain
  db.markWithdrawalFailed(w.id, result.error ?? "payout failed", !result.submitted);
  const refunded = !result.submitted;
  app.log.warn({ userId, id: w.id, error: result.error, submitted: result.submitted }, "withdrawal failed");
  return reply.code(502).send({
    ok: false,
    error: result.error ?? "payout failed",
    refunded,
    status: refunded ? "failed" : "review",
    balance: db.balanceOf(userId),
  });
});

/* ---- staking ---- */
app.get("/staking", async (req, reply) => {
  const userId = auth.verify(bearer(req) ?? undefined);
  if (!userId) return reply.code(401).send({ error: "unauthorized" });
  return { ...db.stakeInfo(userId), balance: db.balanceOf(userId) };
});

app.post("/staking/stake", async (req, reply) => {
  const userId = auth.verify(bearer(req) ?? undefined);
  if (!userId) return reply.code(401).send({ error: "unauthorized" });
  const amount = Math.floor(Number((req.body as any)?.amount ?? 0));
  db.ensureUser(userId);
  try {
    const r = db.stake(userId, amount);
    return { ok: true, ...r, ...db.stakeInfo(userId) };
  } catch (e) {
    return reply.code(400).send({ error: e instanceof Error ? e.message : "stake failed" });
  }
});

app.post("/staking/unstake", async (req, reply) => {
  const userId = auth.verify(bearer(req) ?? undefined);
  if (!userId) return reply.code(401).send({ error: "unauthorized" });
  const amount = Math.floor(Number((req.body as any)?.amount ?? 0));
  try {
    const r = db.unstake(userId, amount);
    return { ok: true, ...r, ...db.stakeInfo(userId) };
  } catch (e) {
    return reply.code(400).send({ error: e instanceof Error ? e.message : "unstake failed" });
  }
});

app.post("/staking/claim", async (req, reply) => {
  const userId = auth.verify(bearer(req) ?? undefined);
  if (!userId) return reply.code(401).send({ error: "unauthorized" });
  const r = db.claimStake(userId);
  return { ok: true, ...r, ...db.stakeInfo(userId) };
});

app.get("/v1/models", async () => {
  const data: any[] = workers
    .modelCatalog()
    .map((m) => ({ id: m.id, object: "model", owned_by: "0c", kind: m.kind }));
  // External verified-math model (not served by contributed GPUs).
  if (verifiedMathEnabled()) {
    data.push({
      id: ARISTOTLE_MODEL,
      object: "model",
      owned_by: "harmonic",
      kind: "chat",
      external: true,
      credits: aristotleCredits,
      note: `formally verified · ${aristotleCredits} cr · prompts leave the 0_C network`,
    });
  }
  return { object: "list", data };
});

/** OpenAI-compatible chat completions (streaming + non-streaming). */
app.post("/v1/chat/completions", async (req, reply) => {
  const userId = auth.verify(bearer(req) ?? undefined);
  if (!userId) return reply.code(401).send({ error: { message: "unauthorized" } });
  const body = (req.body ?? {}) as any;
  const model = body.model ?? "echo";
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return reply.code(400).send({ error: { message: "messages required" } });
  }
  const stream = body.stream === true;
  const id = "chatcmpl-" + Math.random().toString(36).slice(2);
  const created = Math.floor(Date.now() / 1000);

  if (stream) {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    await new Promise<void>((done) => {
      const sink: JobSink = {
        onToken: (_seq, delta) => {
          reply.raw.write(
            `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] })}\n\n`,
          );
        },
        onDone: () => {
          reply.raw.write(
            `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
          );
          reply.raw.write("data: [DONE]\n\n");
          reply.raw.end();
          done();
        },
        onError: (e) => {
          reply.raw.write(`data: ${JSON.stringify({ error: { message: e.message } })}\n\n`);
          reply.raw.end();
          done();
        },
      };
      const res = engine.submit({ userId, model, messages, temperature: body.temperature, maxTokens: body.max_tokens, sink });
      if (!res.ok) {
        reply.raw.write(`data: ${JSON.stringify({ error: { message: res.error } })}\n\n`);
        reply.raw.end();
        done();
      }
    });
    return reply;
  }

  // non-streaming: accumulate
  return await new Promise((resolveResp) => {
    let content = "";
    const sink: JobSink = {
      onToken: (_seq, delta) => (content += delta),
      onDone: (d) =>
        resolveResp({
          id,
          object: "chat.completion",
          created,
          model,
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
          usage: {
            prompt_tokens: d.usage.promptTokens,
            completion_tokens: d.usage.completionTokens,
            total_tokens: d.usage.promptTokens + d.usage.completionTokens,
          },
          x_0c: { charge: d.charge, balance: d.balance, servedBy: d.servedBy },
        }),
      onError: (e) => {
        reply.code(502);
        resolveResp({ error: { message: e.message } });
      },
    };
    const res = engine.submit({ userId, model, messages, temperature: body.temperature, maxTokens: body.max_tokens, sink });
    if (!res.ok) {
      reply.code(402);
      resolveResp({ error: { message: res.error } });
    }
  });
});

await app.listen({ port: PORT, host: HOST });
app.log.info(`0_C orchestrator on http://${HOST}:${PORT}  (db: ${DB_PATH})`);
