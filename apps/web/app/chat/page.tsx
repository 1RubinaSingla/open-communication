"use client";

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { useAuth } from "@/lib/auth";
import { createInferSocket } from "@/lib/sockets";
import { ORCH_URL } from "@/lib/config";
import { SignInGate } from "@/components/SignInGate";
import { Markdown } from "@/components/ui/markdown";
import { createRecognition, speak, stopSpeaking, sttSupported, ttsSupported } from "@/lib/voice";

interface Msg {
  role: "user" | "assistant";
  content: string;
  jobId?: string;
  streaming?: boolean;
  steps?: string[];
  meta?: { charge: number; servedBy: string; tps?: number; transcriptUrl?: string; proofRunId?: string };
}
interface Convo {
  id: string;
  title: string;
  messages: Msg[];
  updated: number;
}

const STORE = "0c-chats";

export default function ChatPage() {
  const { session, refresh } = useAuth();
  const [models, setModels] = useState<string[]>(["echo"]);
  const [externalModels, setExternalModels] = useState<string[]>([]);
  const [model, setModel] = useState("echo");
  const [convos, setConvos] = useState<Convo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakOn, setSpeakOn] = useState(false);
  const [agentOn, setAgentOn] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const jobConvo = useRef<Record<string, string>>({});
  const speakRef = useRef(false);
  const recRef = useRef<any>(null);
  speakRef.current = speakOn;

  const active = convos.find((c) => c.id === activeId) ?? null;

  /* ---- persistence ---- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const parsed = JSON.parse(raw) as Convo[];
        setConvos(parsed);
        if (parsed[0]) setActiveId(parsed[0].id);
      }
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    if (convos.length) localStorage.setItem(STORE, JSON.stringify(convos.slice(0, 50)));
  }, [convos]);

  useEffect(() => {
    fetch(`${ORCH_URL}/v1/models`)
      .then((r) => r.json())
      .then((d) => {
        const usable = (d.data ?? []).filter((m: { kind?: string }) => m.kind !== "image");
        const ids = usable.map((m: { id: string }) => m.id);
        setExternalModels(usable.filter((m: any) => m.external).map((m: any) => m.id));
        if (ids.length) {
          setModels(ids);
          setModel((cur: string) => (ids.includes(cur) ? cur : ids[0]));
        }
      })
      .catch(() => {});
  }, []);

  const patchMsg = (jobId: string, fn: (m: Msg) => Msg) =>
    setConvos((prev) =>
      prev.map((c) =>
        c.id !== jobConvo.current[jobId] ? c : { ...c, messages: c.messages.map((m) => (m.jobId === jobId ? fn(m) : m)) },
      ),
    );

  useEffect(() => {
    if (!session) return;
    const socket = createInferSocket(session.token);
    socketRef.current = socket;
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("job.token", (p: { jobId: string; delta: string }) =>
      patchMsg(p.jobId, (m) => ({ ...m, content: m.content + p.delta })),
    );
    socket.on("job.step", (p: { jobId: string; text: string }) =>
      patchMsg(p.jobId, (m) => ({ ...m, steps: [...(m.steps ?? []), p.text] })),
    );
    socket.on("job.done", (p: { jobId: string; charge: number; balance: number; servedBy: string; timing?: { tokensPerSec: number }; transcriptUrl?: string; proofRunId?: string }) => {
      patchMsg(p.jobId, (m) => {
        if (speakRef.current && m.content) speak(m.content);
        return {
          ...m,
          streaming: false,
          meta: { charge: p.charge, servedBy: p.servedBy, tps: p.timing?.tokensPerSec, transcriptUrl: p.transcriptUrl, proofRunId: p.proofRunId },
        };
      });
      void refresh();
    });
    socket.on("job.error", (p: { jobId: string; message: string }) =>
      patchMsg(p.jobId, (m) => ({ ...m, streaming: false, content: m.content || `⚠ ${p.message}` })),
    );
    return () => {
      socket.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, refresh]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [convos, activeId]);

  function newChat() {
    setActiveId(null);
    setInput("");
  }

  function deleteChat(id: string) {
    setConvos((prev) => {
      const next = prev.filter((c) => c.id !== id);
      localStorage.setItem(STORE, JSON.stringify(next));
      if (activeId === id) setActiveId(next[0]?.id ?? null);
      return next;
    });
  }

  function send() {
    const text = input.trim();
    const socket = socketRef.current;
    if (!text || !socket) return;
    const jobId = crypto.randomUUID();

    // Resolve the target conversation synchronously (not inside the async updater).
    const isNew = !activeId || !convos.some((c) => c.id === activeId);
    const convoId = isNew ? crypto.randomUUID() : (activeId as string);
    jobConvo.current[jobId] = convoId;

    const history = (convos.find((c) => c.id === convoId)?.messages ?? []).concat({ role: "user", content: text });

    setConvos((prev) => {
      const base = isNew
        ? [{ id: convoId, title: text.slice(0, 40), messages: [], updated: Date.now() }, ...prev]
        : prev;
      return base.map((c) =>
        c.id !== convoId
          ? c
          : {
              ...c,
              updated: Date.now(),
              messages: [...c.messages, { role: "user", content: text }, { role: "assistant", content: "", jobId, streaming: true }],
            },
      );
    });
    setActiveId(convoId);
    setInput("");
    socket.emit(
      "job.submit",
      {
        jobId,
        model,
        kind: agentOn ? "agent" : "chat",
        // lets stateful models (Aristotle) continue one reasoning thread
        conversationId: convoId,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
      },
      (ack: { ok: boolean; error?: string }) => {
        if (!ack?.ok) patchMsg(jobId, (m) => ({ ...m, streaming: false, content: `⚠ ${ack?.error ?? "failed"}` }));
      },
    );
  }

  function toggleMic() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = createRecognition();
    if (!rec) return;
    recRef.current = rec;
    rec.onresult = (e: any) => setInput((prev) => (prev ? prev + " " : "") + e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
    setListening(true);
  }

  if (!session) return <SignInGate title="Sign in to chat" />;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] gap-4 py-4">
      {/* sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col gap-2 md:flex">
        <button className="btn btn-primary" onClick={newChat}>
          + NEW CHAT
        </button>
        <div className="scroll-thin flex-1 space-y-1 overflow-y-auto">
          {convos.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-1 rounded-sm px-2 py-1.5 text-sm transition ${
                activeId === c.id ? "bg-panel-2 text-fg" : "text-muted hover:bg-panel-2/60"
              }`}
            >
              <button className="flex-1 truncate text-left" onClick={() => setActiveId(c.id)}>
                {c.title || "untitled"}
              </button>
              <button className="opacity-0 group-hover:opacity-100 hover:text-warn" onClick={() => deleteChat(c.id)} title="delete">
                ✕
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* main */}
      <section className="flex flex-1 flex-col">
        <div className="mb-3 flex items-center gap-3">
          <h1 className="mono text-sm font-semibold tracking-wide">CHAT</h1>
          <span className={`pill ${connected ? "" : "opacity-60"}`}>
            <span className={`dot ${connected ? "live" : ""}`} /> {connected ? "connected" : "connecting…"}
          </span>
          <select className="input !w-auto !py-1.5" value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
                {externalModels.includes(m) ? " ⚠ external" : ""}
              </option>
            ))}
          </select>
          {externalModels.includes(model) && (
            <span className="pill !text-warn" title="This model is served by a third party — your prompt leaves the 0_C network">
              ⚠ leaves network
            </span>
          )}
          <button
            className={`btn !py-1.5 ${agentOn ? "btn-accent" : "btn-ghost"}`}
            onClick={() => setAgentOn((v) => !v)}
            title="Agent mode: the model can search the web and do math (15 cr/run)"
          >
            🛠 AGENT
          </button>
          {ttsSupported() && (
            <button
              className={`btn !py-1.5 ${speakOn ? "btn-accent" : "btn-ghost"}`}
              onClick={() => { const n = !speakOn; setSpeakOn(n); if (!n) stopSpeaking(); }}
              title="Read replies aloud"
            >
              🔊 {speakOn ? "ON" : "OFF"}
            </button>
          )}
        </div>

        <div ref={scrollRef} className="scroll-thin flex-1 space-y-4 overflow-y-auto rounded-2xl border border-border bg-panel/40 p-4">
          {!active || active.messages.length === 0 ? (
            <div className="grid h-full place-items-center text-center text-muted">
              <div>
                <div className="floaty mb-3 text-4xl">◇</div>
                <p className="mono text-sm">Ask anything. Prompts aren't stored server-side — only your credit balance is.</p>
              </div>
            </div>
          ) : (
            active.messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-sm px-4 py-2.5 ${
                    m.role === "user" ? "border border-accent/60 bg-accent/10 text-fg" : "border border-border bg-panel-2 text-fg"
                  }`}
                >
                  {m.role === "assistant" ? (
                    <>
                      {m.steps && m.steps.length > 0 && (
                        <div className="mb-2 space-y-0.5 rounded border border-border bg-black/30 p-2">
                          {m.steps.map((s, si) => (
                            <div key={si} className="mono text-[11px] text-muted">{s}</div>
                          ))}
                        </div>
                      )}
                      <Markdown content={m.content} />
                      {m.streaming && <span className="cursor-blink">▋</span>}
                    </>
                  ) : (
                    <div className="whitespace-pre-wrap text-sm">{m.content}</div>
                  )}
                  {m.meta && (
                    <div className="mono mt-1.5 text-[11px] text-muted">
                      {m.meta.charge} cr · {m.meta.servedBy}
                      {m.meta.tps ? ` · ${Math.round(m.meta.tps)} tok/s` : ""}
                      {m.meta.transcriptUrl && (
                        <>
                          {" · "}
                          <a
                            className="text-accent underline"
                            href={m.meta.transcriptUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="Open the full reasoning transcript on Harmonic (may require their login)"
                          >
                            view reasoning ↗
                          </a>
                        </>
                      )}
                      {m.meta.proofRunId && (
                        <>
                          {" · "}
                          <a className="text-accent underline" href={`/proof/${m.meta.proofRunId}`} target="_blank" rel="noreferrer">
                            signed proof ↗
                          </a>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 flex items-end gap-2">
          {sttSupported() && (
            <button
              className={`btn !px-3 ${listening ? "btn-accent" : "btn-ghost"}`}
              onClick={toggleMic}
              title="Dictate"
            >
              {listening ? "● REC" : "🎤"}
            </button>
          )}
          <textarea
            className="input resize-none"
            rows={1}
            placeholder="Message the network…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="btn btn-primary h-[42px]" onClick={send}>
            SEND
          </button>
        </div>
      </section>
    </div>
  );
}
