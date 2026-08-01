"use client";

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { useAuth } from "@/lib/auth";
import { createWorkerSocket } from "@/lib/sockets";
import { SignInGate } from "@/components/SignInGate";

// Small model so the first load is bearable. Served under a friendly alias.
const WEBLLM_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
const ALIAS = "browser-llama-1b";
const estTokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));

type Phase = "idle" | "loading" | "online" | "unsupported" | "error";

export default function ContributePage() {
  const { session } = useAuth();
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState("");
  const [served, setServed] = useState(0);
  const [err, setErr] = useState("");
  const socketRef = useRef<Socket | null>(null);
  const engineRef = useRef<any>(null);

  useEffect(() => {
    if (typeof navigator !== "undefined" && !(navigator as any).gpu) setPhase("unsupported");
  }, []);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  async function start() {
    if (!session) return;
    setErr("");
    setPhase("loading");
    try {
      const webllm = await import("@mlc-ai/web-llm");
      const engine = await webllm.CreateMLCEngine(WEBLLM_MODEL, {
        initProgressCallback: (r: { text: string; progress: number }) =>
          setProgress(`${r.text} (${Math.round(r.progress * 100)}%)`),
      });
      engineRef.current = engine;

      const socket = createWorkerSocket(session.token);
      socketRef.current = socket;
      socket.on("connect", () => {
        socket.emit("worker.register", {
          name: `browser-${session.userId}`,
          models: [ALIAS],
          capabilities: ["chat"],
          runtime: "web-llm",
        });
        setPhase("online");
      });
      socket.on("disconnect", () => setPhase("idle"));

      socket.on("job.dispatch", async (job: { jobId: string; messages: { role: string; content: string }[] }) => {
        const start = Date.now();
        let firstTokenMs = 0;
        let out = "";
        try {
          // web-llm types the non-streaming overload by default; we always stream.
          const chunks = (await engine.chat.completions.create({
            messages: job.messages,
            stream: true,
          } as any)) as unknown as AsyncIterable<any>;
          for await (const chunk of chunks) {
            const delta = chunk.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              if (firstTokenMs === 0) firstTokenMs = Date.now() - start;
              out += delta;
              socket.emit("job.token", { jobId: job.jobId, delta });
            }
          }
          const totalMs = Date.now() - start;
          const completionTokens = estTokens(out);
          socket.emit("worker.job.done", {
            jobId: job.jobId,
            usage: { promptTokens: job.messages.reduce((n, m) => n + estTokens(m.content), 0), completionTokens },
            timing: { firstTokenMs, totalMs, tokensPerSec: totalMs > 0 ? (completionTokens / totalMs) * 1000 : completionTokens },
          });
          setServed((n) => n + 1);
        } catch (e) {
          socket.emit("worker.job.error", { jobId: job.jobId, message: e instanceof Error ? e.message : String(e) });
        }
      });

      setInterval(() => socket.connected && socket.emit("worker.heartbeat"), 10_000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  function stop() {
    socketRef.current?.close();
    socketRef.current = null;
    setPhase("idle");
  }

  if (!session) return <SignInGate title="Sign in to contribute" />;

  return (
    <div className="mx-auto max-w-2xl py-10">
      <h1 className="text-2xl font-semibold">Contribute your GPU</h1>
      <p className="mt-2 text-muted">
        Turn this browser tab into a worker. It loads a small model with WebGPU and serves inference
        jobs from the network — you earn 70% of the credits each job you complete is worth.
      </p>

      <div className="card mt-6 p-6">
        {phase === "unsupported" ? (
          <div className="text-warn">
            This browser doesn't expose WebGPU (<code>navigator.gpu</code>). Try Chrome/Edge, or run
            the native Ollama worker instead.
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3">
              <span className={`dot ${phase === "online" ? "live" : ""}`} />
              <span className="font-medium capitalize">{phase === "online" ? "online — serving" : phase}</span>
              {phase === "online" && <span className="pill ml-auto">{served} jobs served</span>}
            </div>

            {phase === "loading" && (
              <div className="mb-4 text-sm text-muted">
                Loading {WEBLLM_MODEL}…
                <div className="mt-1 font-mono text-xs">{progress}</div>
              </div>
            )}
            {err && <div className="mb-4 text-sm text-warn">⚠ {err}</div>}

            <div className="flex gap-3">
              {phase === "online" ? (
                <button className="btn btn-ghost" onClick={stop}>
                  Stop contributing
                </button>
              ) : (
                <button className="btn btn-primary" onClick={start} disabled={phase === "loading"}>
                  {phase === "loading" ? "Loading model…" : "Start contributing"}
                </button>
              )}
            </div>
            <p className="mt-4 text-xs text-muted">
              Serves as model <code>{ALIAS}</code>. First load downloads weights (hundreds of MB),
              then they're cached. Keep this tab open to stay online.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
