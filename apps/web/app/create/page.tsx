"use client";

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { useAuth } from "@/lib/auth";
import { createInferSocket } from "@/lib/sockets";
import { ORCH_URL } from "@/lib/config";
import { SignInGate } from "@/components/SignInGate";

interface Gen {
  jobId: string;
  prompt: string;
  dataUrl?: string;
  status: "generating" | "done" | "error";
  meta?: { charge: number; servedBy: string };
  error?: string;
}

export default function CreatePage() {
  const { session, refresh } = useAuth();
  const [models, setModels] = useState<string[]>(["stub-diffusion"]);
  const [model, setModel] = useState("stub-diffusion");
  const [prompt, setPrompt] = useState("");
  const [connected, setConnected] = useState(false);
  const [gens, setGens] = useState<Gen[]>([]);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    fetch(`${ORCH_URL}/v1/models`)
      .then((r) => r.json())
      .then((d) => {
        const imgs = (d.data ?? []).filter((m: any) => m.kind === "image").map((m: any) => m.id);
        if (imgs.length) {
          setModels(imgs);
          setModel((c) => (imgs.includes(c) ? c : imgs[0]));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!session) return;
    const socket = createInferSocket(session.token);
    socketRef.current = socket;
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("job.media", (p: { jobId: string; dataUrl: string }) =>
      setGens((prev) => prev.map((g) => (g.jobId === p.jobId ? { ...g, dataUrl: p.dataUrl } : g))),
    );
    socket.on("job.done", (p: { jobId: string; charge: number; servedBy: string }) => {
      setGens((prev) =>
        prev.map((g) => (g.jobId === p.jobId ? { ...g, status: "done", meta: { charge: p.charge, servedBy: p.servedBy } } : g)),
      );
      void refresh();
    });
    socket.on("job.error", (p: { jobId: string; message: string }) =>
      setGens((prev) => prev.map((g) => (g.jobId === p.jobId ? { ...g, status: "error", error: p.message } : g))),
    );
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [session, refresh]);

  function generate() {
    const text = prompt.trim();
    const socket = socketRef.current;
    if (!text || !socket) return;
    const jobId = crypto.randomUUID();
    setGens((prev) => [{ jobId, prompt: text, status: "generating" }, ...prev]);
    socket.emit(
      "job.submit",
      { jobId, model, kind: "image", messages: [{ role: "user", content: text }] },
      (ack: { ok: boolean; error?: string }) => {
        if (!ack?.ok)
          setGens((prev) => prev.map((g) => (g.jobId === jobId ? { ...g, status: "error", error: ack?.error } : g)));
      },
    );
    setPrompt("");
  }

  if (!session) return <SignInGate title="Sign in to create" />;

  return (
    <div className="space-y-5 py-6">
      <div className="flex items-center gap-3">
        <h1 className="mono text-xl font-semibold tracking-wide">CREATE · IMAGE</h1>
        <span className={`pill ${connected ? "" : "opacity-60"}`}>
          <span className={`dot ${connected ? "live" : ""}`} /> {connected ? "connected" : "connecting…"}
        </span>
        <select className="input !w-auto !py-1.5" value={model} onChange={(e) => setModel(e.target.value)}>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <span className="mono ml-auto text-xs text-muted">20 cr / image</span>
      </div>

      <div className="flex items-end gap-2">
        <textarea
          className="input resize-none"
          rows={2}
          placeholder="Describe an image…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              generate();
            }
          }}
        />
        <button className="btn btn-accent h-[52px]" onClick={generate}>
          GENERATE
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {gens.map((g) => (
          <div key={g.jobId} className="card overflow-hidden">
            <div className="aspect-square bg-panel-2">
              {g.dataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={g.dataUrl} alt={g.prompt} className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full place-items-center">
                  <span className="mono text-xs text-muted">
                    {g.status === "error" ? `⚠ ${g.error ?? "failed"}` : "rendering…"}
                  </span>
                </div>
              )}
            </div>
            <div className="p-3">
              <div className="mono truncate text-xs text-fg">{g.prompt}</div>
              <div className="mono mt-1 text-[10px] text-muted">
                {g.meta ? `${g.meta.charge} cr · ${g.meta.servedBy}` : g.status}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
