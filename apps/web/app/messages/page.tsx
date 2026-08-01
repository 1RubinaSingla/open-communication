"use client";

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { useAuth } from "@/lib/auth";
import { createCommsSocket } from "@/lib/sockets";
import { open, seal, safetyNumber, type Identity } from "@0c/crypto";
import { loadOrCreateIdentity } from "@0c/crypto/keystore";
import { SignInGate } from "@/components/SignInGate";

interface DM {
  from: string;
  text: string;
  ts: number;
  mine: boolean;
}

export default function MessagesPage() {
  const { session } = useAuth();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [connected, setConnected] = useState(false);
  const [convos, setConvos] = useState<Record<string, DM[]>>({});
  const [active, setActive] = useState<string | null>(null);
  const [peerInput, setPeerInput] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const socketRef = useRef<Socket | null>(null);
  const identityRef = useRef<Identity | null>(null);
  const keyCache = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!session) return;
    let socket: Socket;
    (async () => {
      const id = await loadOrCreateIdentity();
      setIdentity(id);
      identityRef.current = id;

      socket = createCommsSocket(session.token);
      socketRef.current = socket;
      socket.on("connect", () => {
        setConnected(true);
        socket.emit("key.publish", { publicKey: id.publicKey });
        socket.emit("dm.sync", (res: { messages: IncomingDM[] }) => {
          for (const m of res?.messages ?? []) ingest(m);
        });
      });
      socket.on("disconnect", () => setConnected(false));
      socket.on("dm.recv", (m: IncomingDM) => ingest(m));
    })();

    return () => {
      socketRef.current?.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  interface IncomingDM {
    fromUserId: string;
    ciphertext: string;
    nonce: string;
    epk: string;
    ts: number;
  }

  function ingest(m: IncomingDM) {
    const id = identityRef.current;
    if (!id) return;
    let text: string;
    try {
      text = open(id, { ciphertext: m.ciphertext, nonce: m.nonce, epk: m.epk });
    } catch {
      text = "⚠ could not decrypt";
    }
    setConvos((prev) => ({
      ...prev,
      [m.fromUserId]: [...(prev[m.fromUserId] ?? []), { from: m.fromUserId, text, ts: m.ts, mine: false }],
    }));
  }

  async function ensurePeerKey(userId: string): Promise<string | null> {
    if (keyCache.current[userId]) return keyCache.current[userId]!;
    const socket = socketRef.current;
    if (!socket) return null;
    return new Promise((resolve) => {
      socket.emit("key.fetch", { userId }, (res: { ok: boolean; publicKey?: string; error?: string }) => {
        if (res?.ok && res.publicKey) {
          keyCache.current[userId] = res.publicKey;
          resolve(res.publicKey);
        } else {
          resolve(null);
        }
      });
    });
  }

  async function startChat() {
    const peer = peerInput.trim();
    if (!peer || peer === session?.userId) return;
    setError("");
    const key = await ensurePeerKey(peer);
    if (!key) {
      setError(`No published key for @${peer}. They must open Messages at least once.`);
      return;
    }
    setConvos((prev) => ({ ...prev, [peer]: prev[peer] ?? [] }));
    setActive(peer);
    setPeerInput("");
  }

  async function send() {
    const text = draft.trim();
    const socket = socketRef.current;
    if (!text || !socket || !active) return;
    const key = await ensurePeerKey(active);
    if (!key) {
      setError(`No key for @${active}.`);
      return;
    }
    const box = seal(key, text);
    socket.emit(
      "dm.send",
      { toUserId: active, ciphertext: box.ciphertext, nonce: box.nonce, epk: box.epk },
      (res: { ok: boolean; ts?: number }) => {
        if (res?.ok) {
          setConvos((prev) => ({
            ...prev,
            [active]: [...(prev[active] ?? []), { from: session!.userId, text, ts: res.ts ?? Date.now(), mine: true }],
          }));
        }
      },
    );
    setDraft("");
  }

  if (!session) return <SignInGate title="Sign in to message" />;

  const peers = Object.keys(convos);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] gap-4 py-4">
      {/* sidebar */}
      <aside className="flex w-64 shrink-0 flex-col gap-3">
        <div className="flex items-center gap-2">
          <input
            className="input !py-1.5"
            placeholder="@username"
            value={peerInput}
            onChange={(e) => setPeerInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && startChat()}
          />
          <button className="btn btn-primary !px-3" onClick={startChat}>
            +
          </button>
        </div>
        {error && <div className="text-xs text-warn">{error}</div>}
        <div className="scroll-thin flex-1 space-y-1 overflow-y-auto">
          {peers.length === 0 && <p className="px-1 text-sm text-muted">No conversations yet.</p>}
          {peers.map((p) => (
            <button
              key={p}
              onClick={() => setActive(p)}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                active === p ? "bg-panel-2 text-fg" : "text-muted hover:bg-panel-2/60"
              }`}
            >
              @{p}
              <div className="truncate text-xs text-muted/70">
                {convos[p]?.at(-1)?.text ?? "encrypted"}
              </div>
            </button>
          ))}
        </div>
        <div className="card p-3 text-[11px] text-muted">
          <div className="mb-1 flex items-center gap-2">
            <span className={`dot ${connected ? "live" : ""}`} /> E2E encrypted
          </div>
          {identity && (
            <div title="Your safety number — compare with a peer to verify no MITM">
              <span className="text-muted/70">safety #</span>
              <div className="mt-0.5 break-words font-mono text-[10px] leading-tight">
                {safetyNumber(identity.publicKey)}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* thread */}
      <section className="flex flex-1 flex-col rounded-2xl border border-border bg-panel/40">
        {!active ? (
          <div className="grid flex-1 place-items-center text-center text-muted">
            <div>
              <div className="floaty mb-3 text-4xl">⬡</div>
              <p>Select or start a conversation. Messages are encrypted on your device —<br />the server only relays ciphertext.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">@{active}</div>
            <div className="scroll-thin flex-1 space-y-3 overflow-y-auto p-4">
              {(convos[active] ?? []).map((m, i) => (
                <div key={i} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[75%] rounded-sm px-4 py-2 text-sm ${
                      m.mine ? "border border-accent/60 bg-accent/10 text-fg" : "border border-border bg-panel-2"
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-end gap-2 border-t border-border p-3">
              <input
                className="input"
                placeholder="Encrypted message…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
              />
              <button className="btn btn-primary" onClick={send}>
                Send
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
