import { randomUUID } from "node:crypto";
import type { Namespace } from "socket.io";
import { Ev, type ChatMessage, type JobKind } from "@0c/protocol";
import { estimateTokens, imageCost, reserveEstimate } from "@0c/credits";
import { InsufficientCreditsError, type Db } from "@0c/db";
import type { WorkerRegistry } from "./registry.js";

/** Transport-agnostic destination for a job's stream (a socket client, or an SSE response). */
export interface JobSink {
  onToken(seq: number, delta: string): void;
  onMedia?(mimeType: string, dataUrl: string): void;
  onStep?(text: string): void;
  onDone(d: {
    usage: { promptTokens: number; completionTokens: number };
    charge: number;
    balance: number;
    timing?: { firstTokenMs: number; totalMs: number; tokensPerSec: number };
    servedBy: string;
    /** External transcript URL, when the work ran on an outside service. */
    transcriptUrl?: string;
    /** Signed provenance record id (served at /proof/<id>). */
    proofRunId?: string;
  }): void;
  onError(e: { message: string; refunded: boolean }): void;
}

interface ActiveJob {
  jobId: string;
  userId: string;
  model: string;
  kind: JobKind;
  reserve: number;
  fixedCharge?: number;
  promptTokens: number;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  sink: JobSink;
  seq: number;
  workerSocketId?: string;
  workerName?: string;
  startedAt?: number;
  queueTimer?: NodeJS.Timeout;
}

const QUEUE_TIMEOUT_MS = 30_000;

/**
 * The heart of the /infer side: reserves credits, routes each job to the
 * fastest idle worker, relays streamed tokens to the caller's sink, and settles
 * or refunds on completion. Fully transport-agnostic so both Socket.IO clients
 * and the OpenAI-compatible REST endpoint share one code path.
 */
export class InferenceEngine {
  private active = new Map<string, ActiveJob>();
  private queue: string[] = [];

  constructor(
    private db: Db,
    private workers: WorkerRegistry,
    private infer: Namespace,
  ) {}

  submit(params: {
    userId: string;
    model: string;
    kind?: JobKind;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    sink: JobSink;
    jobId?: string;
  }): { ok: true; jobId: string; reserved: number } | { ok: false; error: string } {
    const jobId = params.jobId ?? randomUUID();
    const kind: JobKind = params.kind ?? "chat";
    const promptTokens = params.messages.reduce((n, m) => n + estimateTokens(m.content), 0);
    const fixedCharge = kind === "image" ? imageCost() : undefined;
    const reserve = fixedCharge ?? reserveEstimate(params.model, promptTokens, params.maxTokens ?? 512);

    try {
      this.db.reserve(params.userId, jobId, reserve, params.model);
    } catch (err) {
      if (err instanceof InsufficientCreditsError) return { ok: false, error: err.message };
      throw err;
    }

    const job: ActiveJob = {
      jobId,
      userId: params.userId,
      model: params.model,
      kind,
      reserve,
      fixedCharge,
      promptTokens,
      messages: params.messages,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      sink: params.sink,
      seq: 0,
    };
    this.active.set(jobId, job);
    this.queue.push(jobId);
    job.queueTimer = setTimeout(() => this.failQueued(jobId), QUEUE_TIMEOUT_MS);
    this.schedule();
    return { ok: true, jobId, reserved: reserve };
  }

  private schedule() {
    if (this.queue.length === 0) return;
    const stillQueued: string[] = [];
    for (const jobId of this.queue) {
      const job = this.active.get(jobId);
      if (!job || job.workerSocketId) continue;
      const worker = this.workers.pickIdle(job.model);
      if (!worker) {
        stillQueued.push(jobId);
        continue;
      }
      worker.busy = true;
      job.workerSocketId = worker.socket.id;
      job.workerName = worker.name;
      job.startedAt = Date.now();
      if (job.queueTimer) clearTimeout(job.queueTimer);
      worker.socket.emit(Ev.jobDispatch, {
        jobId: job.jobId,
        model: job.model,
        kind: job.kind,
        messages: job.messages,
        temperature: job.temperature,
        maxTokens: job.maxTokens,
        canary: false,
      });
    }
    this.queue = stillQueued;
  }

  private failQueued(jobId: string) {
    const job = this.active.get(jobId);
    if (!job || job.workerSocketId) return;
    this.queue = this.queue.filter((id) => id !== jobId);
    this.db.refund(job.userId, jobId, job.reserve);
    job.sink.onError({ message: "no worker available for model " + job.model, refunded: true });
    this.active.delete(jobId);
  }

  /* ---- worker -> orchestrator callbacks (wired in server.ts) ---- */

  onWorkerToken(jobId: string, delta: string) {
    const job = this.active.get(jobId);
    if (!job) return;
    job.sink.onToken(job.seq++, delta);
  }

  onWorkerMedia(jobId: string, mimeType: string, dataUrl: string) {
    const job = this.active.get(jobId);
    if (!job) return;
    job.sink.onMedia?.(mimeType, dataUrl);
  }

  onWorkerDone(
    socketId: string,
    jobId: string,
    usage: { promptTokens: number; completionTokens: number },
    timing: { firstTokenMs: number; totalMs: number; tokensPerSec: number },
  ) {
    const job = this.active.get(jobId);
    if (!job) return;
    const worker = this.workers.get(socketId);
    if (worker) {
      worker.busy = false;
      this.workers.recordThroughput(socketId, timing.tokensPerSec);
    }
    const result = this.db.settle(
      job.userId,
      jobId,
      job.reserve,
      job.model,
      usage,
      job.workerName ?? "",
      job.fixedCharge,
    );
    job.sink.onDone({
      usage,
      charge: result.charge,
      balance: result.balance,
      timing,
      servedBy: job.workerName ?? "unknown",
    });
    this.active.delete(jobId);
    this.schedule();
  }

  onWorkerError(socketId: string, jobId: string, message: string) {
    const job = this.active.get(jobId);
    const worker = this.workers.get(socketId);
    if (worker) worker.busy = false;
    if (job) {
      this.db.refund(job.userId, jobId, job.reserve);
      job.sink.onError({ message, refunded: true });
      this.active.delete(jobId);
    }
    this.schedule();
  }

  /** A worker vanished mid-job: refund every job it was serving. */
  onWorkerGone(socketId: string) {
    for (const job of [...this.active.values()]) {
      if (job.workerSocketId === socketId) {
        this.db.refund(job.userId, job.jobId, job.reserve);
        job.sink.onError({ message: "worker disconnected", refunded: true });
        this.active.delete(job.jobId);
      }
    }
    this.schedule();
  }
}
