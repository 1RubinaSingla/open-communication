import type { Socket } from "socket.io";

export interface WorkerEntry {
  socket: Socket;
  name: string;
  models: Set<string>;
  imageModels: Set<string>;
  capabilities: Set<string>;
  runtime: string;
  busy: boolean;
  /** Exponential moving average of tokens/sec — drives fastest-idle routing. */
  emaTokensPerSec: number;
  jobsServed: number;
  lastSeen: number;
}

/** Tracks connected workers and picks the fastest idle one for a model. */
export class WorkerRegistry {
  private workers = new Map<string, WorkerEntry>(); // socketId -> entry

  add(
    socket: Socket,
    reg: { name: string; models: string[]; imageModels?: string[]; capabilities: string[]; runtime: string },
  ) {
    this.workers.set(socket.id, {
      socket,
      name: reg.name,
      models: new Set(reg.models),
      imageModels: new Set(reg.imageModels ?? []),
      capabilities: new Set(reg.capabilities),
      runtime: reg.runtime,
      busy: false,
      emaTokensPerSec: 0,
      jobsServed: 0,
      lastSeen: Date.now(),
    });
  }

  remove(socketId: string) {
    this.workers.delete(socketId);
  }

  get(socketId: string): WorkerEntry | undefined {
    return this.workers.get(socketId);
  }

  bySocket(socketId: string) {
    return this.workers.get(socketId);
  }

  touch(socketId: string) {
    const w = this.workers.get(socketId);
    if (w) w.lastSeen = Date.now();
  }

  /** Fastest idle worker that can serve `model` (+ optional capability). */
  pickIdle(model: string, capability?: string): WorkerEntry | undefined {
    let best: WorkerEntry | undefined;
    for (const w of this.workers.values()) {
      if (w.busy) continue;
      if (!w.models.has(model)) continue;
      if (capability && !w.capabilities.has(capability)) continue;
      if (!best || w.emaTokensPerSec > best.emaTokensPerSec) best = w;
    }
    return best;
  }

  recordThroughput(socketId: string, tokensPerSec: number) {
    const w = this.workers.get(socketId);
    if (!w) return;
    w.emaTokensPerSec = w.emaTokensPerSec === 0 ? tokensPerSec : w.emaTokensPerSec * 0.7 + tokensPerSec * 0.3;
    w.jobsServed++;
  }

  stats() {
    return [...this.workers.values()].map((w) => ({
      name: w.name,
      models: [...w.models],
      imageModels: [...w.imageModels],
      capabilities: [...w.capabilities],
      runtime: w.runtime,
      busy: w.busy,
      tokensPerSec: Math.round(w.emaTokensPerSec),
      jobsServed: w.jobsServed,
    }));
  }

  /** Union of every worker's models tagged with kind (chat|image). */
  modelCatalog(): Array<{ id: string; kind: "chat" | "image" }> {
    const image = new Set<string>();
    const all = new Set<string>();
    for (const w of this.workers.values()) {
      for (const m of w.models) all.add(m);
      for (const m of w.imageModels) image.add(m);
    }
    return [...all].map((id) => ({ id, kind: image.has(id) ? "image" : "chat" }));
  }

  get size() {
    return this.workers.size;
  }
}

/** Maps a userId to all of its live socket ids (a user may have many tabs/devices). */
export class ConnectionRegistry {
  private byUser = new Map<string, Set<string>>();

  add(userId: string, socketId: string) {
    let set = this.byUser.get(userId);
    if (!set) this.byUser.set(userId, (set = new Set()));
    set.add(socketId);
  }

  remove(userId: string, socketId: string) {
    const set = this.byUser.get(userId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) this.byUser.delete(userId);
  }

  socketsFor(userId: string): string[] {
    return [...(this.byUser.get(userId) ?? [])];
  }

  isOnline(userId: string): boolean {
    return (this.byUser.get(userId)?.size ?? 0) > 0;
  }
}
