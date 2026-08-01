import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { io } from "socket.io-client";
import { Ev, type ChatMessage } from "@0c/protocol";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

const ORCH_URL = process.env.WORKER_ORCH_URL ?? "http://localhost:4000";
const SECRET = process.env.WORKER_SECRET ?? process.env.ORCH_SECRET ?? "dev-secret-change-me";
const NAME = process.env.WORKER_NAME ?? "native-1";
const OLLAMA_URL = process.env.OLLAMA_URL ?? "";

const estTokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const IMAGE_MODEL = "stub-diffusion";

/** Deterministic procedural image from a prompt (real SD/Flux worker drops in later). */
function generateImage(prompt: string): string {
  let seed = 2166136261;
  for (let i = 0; i < prompt.length; i++) seed = Math.imul(seed ^ prompt.charCodeAt(i), 16777619) >>> 0;
  const rng = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const hue = Math.floor(rng() * 360);
  const shapes = Array.from({ length: 7 }, () => {
    const h = (hue + Math.floor(rng() * 120)) % 360;
    return `<circle cx="${Math.floor(rng() * 512)}" cy="${Math.floor(rng() * 512)}" r="${40 + Math.floor(rng() * 160)}" fill="hsl(${h} 80% 60%)" opacity="${(0.25 + rng() * 0.5).toFixed(2)}"/>`;
  }).join("");
  const safe = prompt.replace(/[<&>]/g, "").slice(0, 48);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <defs><filter id="b"><feGaussianBlur stdDeviation="18"/></filter></defs>
    <rect width="512" height="512" fill="hsl(${hue} 40% 8%)"/>
    <g filter="url(#b)">${shapes}</g>
    <rect width="512" height="512" fill="none"/>
    <text x="256" y="490" font-family="monospace" font-size="14" fill="#ffffffcc" text-anchor="middle">0_C · ${safe}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

interface Runtime {
  models: string[];
  runtime: string;
}

/** Probe Ollama; if it's up, expose its models. Always expose the echo model. */
async function detectRuntime(): Promise<Runtime> {
  const models = new Set<string>(["echo"]);
  let runtime = "echo";
  if (OLLAMA_URL) {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const data = (await res.json()) as { models?: Array<{ name: string }> };
        for (const m of data.models ?? []) models.add(m.name.replace(/:latest$/, ""));
        runtime = "ollama";
        console.log(`[worker] Ollama detected at ${OLLAMA_URL} — models: ${[...models].join(", ")}`);
      }
    } catch {
      console.log(`[worker] Ollama not reachable at ${OLLAMA_URL} — echo model only.`);
    }
  } else {
    console.log("[worker] OLLAMA_URL unset — echo model only.");
  }
  return { models: [...models], runtime };
}

type Emit = (delta: string) => void;

/** Built-in streaming model so the full pipeline runs with zero external deps. */
async function runEcho(messages: ChatMessage[], emit: Emit): Promise<void> {
  const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const reply =
    `You said: "${last}". ` +
    `This is the 0_C echo model streaming a response token by token. ` +
    `Install Ollama and set OLLAMA_URL to serve real models on this worker.`;
  for (const word of reply.split(" ")) {
    emit(word + " ");
    await sleep(35);
  }
}

/** Real inference via Ollama's streaming chat API. */
async function runOllama(model: string, messages: ChatMessage[], emit: Emit): Promise<void> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`ollama http ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const obj = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
      const delta = obj.message?.content;
      if (delta) emit(delta);
    }
  }
}

async function main() {
  const rt = await detectRuntime();
  const socket = io(`${ORCH_URL}${"/infer"}`, {
    auth: { kind: "worker", workerSecret: SECRET },
    // polling first, then upgrade to websocket — most proxy/edge friendly (Railway, etc.)
    transports: ["polling", "websocket"],
    reconnection: true,
  });

  socket.on("connect", () => {
    console.log(`[worker] connected to ${ORCH_URL} as "${NAME}"`);
    socket.emit(Ev.workerRegister, {
      name: NAME,
      models: [...rt.models, IMAGE_MODEL],
      imageModels: [IMAGE_MODEL],
      // agents need Ollama tool-calling; echo-only workers can't run them
      capabilities: rt.runtime === "ollama" ? ["chat", "image", "agent"] : ["chat", "image"],
      runtime: rt.runtime,
    });
  });
  socket.on("connect_error", (e) => console.error("[worker] connect_error:", e.message));
  socket.on("disconnect", () => console.log("[worker] disconnected"));

  setInterval(() => socket.connected && socket.emit(Ev.workerHeartbeat), 10_000);

  // Agent turn: one non-streaming Ollama call that may return tool calls.
  socket.on(Ev.agentTurn, async (payload: { model: string; messages: any[]; tools: any[] }, ack: (r: any) => void) => {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: payload.model, messages: payload.messages, tools: payload.tools, stream: false }),
      });
      if (!res.ok) throw new Error(`ollama http ${res.status}`);
      const data = (await res.json()) as { message?: { content?: string; tool_calls?: any[] } };
      ack({ ok: true, message: data.message ?? { content: "" } });
    } catch (err) {
      ack({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  socket.on(Ev.jobDispatch, async (job: {
    jobId: string;
    model: string;
    kind?: string;
    messages: ChatMessage[];
  }) => {
    const start = Date.now();

    // ---- image jobs ----
    if (job.kind === "image" || job.model === IMAGE_MODEL) {
      try {
        const prompt = [...job.messages].reverse().find((m) => m.role === "user")?.content ?? "";
        const dataUrl = generateImage(prompt);
        socket.emit(Ev.jobMedia, { jobId: job.jobId, mimeType: "image/svg+xml", dataUrl });
        const totalMs = Date.now() - start;
        socket.emit(Ev.workerJobDone, {
          jobId: job.jobId,
          usage: { promptTokens: estTokens(prompt), completionTokens: 0 },
          timing: { firstTokenMs: totalMs, totalMs, tokensPerSec: 0 },
        });
        console.log(`[worker] rendered image ${job.jobId} in ${totalMs}ms`);
      } catch (err) {
        socket.emit(Ev.workerJobError, { jobId: job.jobId, message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // ---- chat jobs ----
    let firstTokenMs = 0;
    let out = "";
    const emit: Emit = (delta) => {
      if (firstTokenMs === 0) firstTokenMs = Date.now() - start;
      out += delta;
      socket.emit(Ev.jobToken, { jobId: job.jobId, delta });
    };
    try {
      if (job.model !== "echo" && rt.runtime === "ollama") {
        await runOllama(job.model, job.messages, emit);
      } else {
        await runEcho(job.messages, emit);
      }
      const totalMs = Date.now() - start;
      const completionTokens = estTokens(out);
      const promptTokens = job.messages.reduce((n, m) => n + estTokens(m.content), 0);
      socket.emit(Ev.workerJobDone, {
        jobId: job.jobId,
        usage: { promptTokens, completionTokens },
        timing: {
          firstTokenMs,
          totalMs,
          tokensPerSec: totalMs > 0 ? (completionTokens / totalMs) * 1000 : completionTokens,
        },
      });
      console.log(`[worker] served ${job.jobId} (${job.model}) — ${completionTokens} tok in ${totalMs}ms`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      socket.emit(Ev.workerJobError, { jobId: job.jobId, message });
      console.error(`[worker] job ${job.jobId} failed:`, message);
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
