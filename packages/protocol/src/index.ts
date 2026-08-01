import { z } from "zod";

/**
 * @0c/protocol — the single source of truth for every wire message that crosses
 * the boundary between the web client, the orchestrator, and the workers.
 *
 * One orchestrator carries TWO protocols over one Socket.IO server:
 *   - the `/infer` namespace: AI inference jobs (clients + workers)
 *   - the `/comms` namespace: E2E-encrypted messaging relay (clients only)
 *
 * Everything here is Zod-first so both sides validate at the boundary and the
 * TS types are inferred, never hand-maintained.
 */

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

export const ChatRole = z.enum(["system", "user", "assistant"]);
export type ChatRole = z.infer<typeof ChatRole>;

export const ChatMessage = z.object({
  role: ChatRole,
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const Usage = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof Usage>;

export const JobTiming = z.object({
  /** ms from dispatch to first token — the latency users feel. */
  firstTokenMs: z.number().nonnegative(),
  /** ms for the whole generation. */
  totalMs: z.number().nonnegative(),
  /** completion tokens / second — used for fastest-idle routing + anti-cheat. */
  tokensPerSec: z.number().nonnegative(),
});
export type JobTiming = z.infer<typeof JobTiming>;

/* ------------------------------------------------------------------ */
/* /infer — client <-> orchestrator                                    */
/* ------------------------------------------------------------------ */

export const JobKind = z.enum(["chat", "image", "agent"]);
export type JobKind = z.infer<typeof JobKind>;

export const JobSubmit = z.object({
  /** Client-generated id so the client can correlate its own streams. */
  jobId: z.string().min(1),
  model: z.string().min(1),
  /** For images, the prompt is the last user message. */
  messages: z.array(ChatMessage).min(1),
  kind: JobKind.default("chat"),
  /**
   * Client-side conversation id. Lets stateful backends (e.g. Aristotle) keep
   * one reasoning thread across follow-up messages instead of starting over.
   */
  conversationId: z.string().optional(),
  /** 0..2 — forwarded to the worker runtime. */
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(8192).optional(),
});
export type JobSubmit = z.infer<typeof JobSubmit>;

/** A non-text result (image/audio/…) delivered as a data: URL. */
export const JobMedia = z.object({
  jobId: z.string(),
  mimeType: z.string(),
  dataUrl: z.string(),
});
export type JobMedia = z.infer<typeof JobMedia>;

/** Ack returned to the client for `job.submit`. */
export const JobSubmitAck = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), jobId: z.string(), reservedCredits: z.number() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type JobSubmitAck = z.infer<typeof JobSubmitAck>;

export const JobToken = z.object({
  jobId: z.string(),
  /** Monotonically increasing per job — lets a reconnecting client detect gaps. */
  seq: z.number().int().nonnegative(),
  delta: z.string(),
});
export type JobToken = z.infer<typeof JobToken>;

export const JobDone = z.object({
  jobId: z.string(),
  usage: Usage,
  /** Credits actually charged after settlement (1 credit = $0.01). */
  charge: z.number().nonnegative(),
  balance: z.number(),
  timing: JobTiming.optional(),
  servedBy: z.string().optional(),
  /** External transcript (e.g. the Aristotle project) the user can open. */
  transcriptUrl: z.string().optional(),
  /** Run id of the signed provenance record, served at /proof/<id>. */
  proofRunId: z.string().optional(),
});
export type JobDone = z.infer<typeof JobDone>;

export const JobError = z.object({
  jobId: z.string(),
  message: z.string(),
  /** true when the reservation was refunded (no charge). */
  refunded: z.boolean().default(true),
});
export type JobError = z.infer<typeof JobError>;

/* ------------------------------------------------------------------ */
/* /infer — worker <-> orchestrator                                    */
/* ------------------------------------------------------------------ */

export const WorkerRegister = z.object({
  name: z.string().min(1),
  /** All servable models (used for routing). */
  models: z.array(z.string()).min(1),
  /** Subset of `models` that produce images. */
  imageModels: z.array(z.string()).default([]),
  /** e.g. ["chat"] now; ["chat","image","voice"] later. */
  capabilities: z.array(z.string()).default(["chat"]),
  runtime: z.string().default("unknown"),
});
export type WorkerRegister = z.infer<typeof WorkerRegister>;

/** Orchestrator -> worker: run this job. */
export const JobDispatch = z.object({
  jobId: z.string(),
  model: z.string(),
  kind: JobKind.default("chat"),
  messages: z.array(ChatMessage),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  /** Low-rate canary jobs are marked so the orchestrator can score the worker. */
  canary: z.boolean().default(false),
});
export type JobDispatch = z.infer<typeof JobDispatch>;

/** Worker -> orchestrator when a job finishes. */
export const WorkerJobDone = z.object({
  jobId: z.string(),
  usage: Usage,
  timing: JobTiming,
});
export type WorkerJobDone = z.infer<typeof WorkerJobDone>;

export const WorkerJobError = z.object({
  jobId: z.string(),
  message: z.string(),
});
export type WorkerJobError = z.infer<typeof WorkerJobError>;

/* ------------------------------------------------------------------ */
/* /comms — client <-> orchestrator (blind relay)                      */
/* ------------------------------------------------------------------ */

/** Publish this user's long-term X25519 public identity key. */
export const KeyPublish = z.object({
  /** base64url-encoded 32-byte X25519 public key. */
  publicKey: z.string().min(1),
});
export type KeyPublish = z.infer<typeof KeyPublish>;

export const KeyFetch = z.object({
  userId: z.string().min(1),
});
export type KeyFetch = z.infer<typeof KeyFetch>;

export const KeyFetchAck = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), userId: z.string(), publicKey: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type KeyFetchAck = z.infer<typeof KeyFetchAck>;

/**
 * An encrypted direct message. The orchestrator NEVER sees plaintext — it only
 * stores/relays the ciphertext blob and routing metadata.
 */
export const DmSend = z.object({
  toUserId: z.string().min(1),
  /** base64url XChaCha20-Poly1305 ciphertext. */
  ciphertext: z.string().min(1),
  /** base64url 24-byte nonce. */
  nonce: z.string().min(1),
  /** base64url ephemeral X25519 public key (sealed-box style). */
  epk: z.string().min(1),
});
export type DmSend = z.infer<typeof DmSend>;

export const DmSendAck = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), messageId: z.string(), ts: z.number() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type DmSendAck = z.infer<typeof DmSendAck>;

export const DmRecv = z.object({
  messageId: z.string(),
  fromUserId: z.string(),
  toUserId: z.string(),
  ciphertext: z.string(),
  nonce: z.string(),
  epk: z.string(),
  ts: z.number(),
});
export type DmRecv = z.infer<typeof DmRecv>;

/** Ack payload for `dm.sync` — everything queued while the user was offline. */
export const DmSyncAck = z.object({
  messages: z.array(DmRecv),
});
export type DmSyncAck = z.infer<typeof DmSyncAck>;

/* ------------------------------------------------------------------ */
/* Event name constants — imported by client, orchestrator, worker     */
/* ------------------------------------------------------------------ */

export const INFER_NS = "/infer" as const;
export const COMMS_NS = "/comms" as const;

export const Ev = {
  // client <-> orchestrator (infer)
  jobSubmit: "job.submit",
  jobToken: "job.token",
  jobMedia: "job.media",
  jobStep: "job.step",
  jobDone: "job.done",
  jobError: "job.error",
  // agent (orchestrator <-> worker, request/reply via ack)
  agentTurn: "agent.turn",
  // worker <-> orchestrator (infer)
  workerRegister: "worker.register",
  workerHeartbeat: "worker.heartbeat",
  jobDispatch: "job.dispatch",
  workerJobDone: "worker.job.done",
  workerJobError: "worker.job.error",
  // client <-> orchestrator (comms)
  keyPublish: "key.publish",
  keyFetch: "key.fetch",
  dmSend: "dm.send",
  dmRecv: "dm.recv",
  dmSync: "dm.sync",
} as const;

/* ------------------------------------------------------------------ */
/* Auth handshake payloads (socket.handshake.auth)                     */
/* ------------------------------------------------------------------ */

/** Users connect with a signed dev token; workers with the shared secret. */
export const HandshakeAuth = z.object({
  kind: z.enum(["user", "worker"]).default("user"),
  token: z.string().optional(),
  /** worker-only */
  workerSecret: z.string().optional(),
});
export type HandshakeAuth = z.infer<typeof HandshakeAuth>;
