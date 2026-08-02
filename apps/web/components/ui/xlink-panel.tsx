"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { ORCH_URL } from "@/lib/config";
import { connectWallet } from "@/lib/eth";

interface XConfig {
  enabled: boolean;
  handle: string;
  gateConfigured: boolean;
  tier1Tokens: number;
  tier2Tokens: number;
  tier1DailyLimit: number;
  linkPrefix: string;
}
interface LinkStatus {
  linked: boolean;
  code?: string;
  wallet?: string;
  xHandle?: string | null;
  tier?: "none" | "limited" | "unlimited";
  balance?: number;
  dailyLimit?: number | null;
}

type Phase = "idle" | "connecting" | "creating" | "error";

export function XLinkPanel() {
  const { session } = useAuth();
  const [cfg, setCfg] = useState<XConfig | null>(null);
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!session) return;
    try {
      const s = await fetch(`${ORCH_URL}/x/link/status`, {
        headers: { Authorization: `Bearer ${session.token}` },
      }).then((r) => r.json());
      setStatus(s);
    } catch {
      /* orchestrator may be offline */
    }
  }, [session]);

  useEffect(() => {
    fetch(`${ORCH_URL}/x/config`).then((r) => r.json()).then(setCfg).catch(() => {});
    loadStatus();
  }, [loadStatus]);

  // Nothing to tweet at until a bot account is configured.
  if (!cfg || !cfg.handle) return null;

  async function startLink() {
    if (!session) return;
    setMsg("");
    try {
      setPhase("connecting");
      const wallet = await connectWallet();
      setPhase("creating");
      const res = await fetch(`${ORCH_URL}/x/link/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ wallet }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "could not create a code");
      setPhase("idle");
      await loadStatus();
    } catch (e) {
      setPhase("error");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  const code = status?.code;
  const tweetText = code ? `${code} @${cfg.handle}` : "";
  const intentUrl = `https://x.com/intent/post?text=${encodeURIComponent(tweetText)}`;
  const busy = phase === "connecting" || phase === "creating";

  const tierLabel =
    status?.tier === "unlimited" ? "unlimited" : status?.tier === "limited" ? `${status.dailyLimit}/day` : "no access";
  const tierColor =
    status?.tier === "unlimited" ? "text-good" : status?.tier === "limited" ? "text-accent" : "text-warn";

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="mono text-sm font-semibold tracking-wide">LINK X · $0C ACCESS</h2>
        <span className="pill">{cfg.enabled ? `@${cfg.handle}` : "bot offline"}</span>
      </div>

      <p className="text-xs text-muted">
        Link your wallet to your X account to use{" "}
        <code className="mono text-accent">/prove</code> with the bot. Holding{" "}
        {cfg.tier1Tokens.toLocaleString()}+ $0C gives {cfg.tier1DailyLimit}/day;{" "}
        {cfg.tier2Tokens.toLocaleString()}+ is unlimited.
      </p>

      {/* linked */}
      {status?.linked ? (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between border-b border-border/50 pb-2">
            <span className="mono text-[10px] uppercase tracking-wider text-muted">X account</span>
            <span className="mono text-xs text-fg">@{status.xHandle}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border/50 pb-2">
            <span className="mono text-[10px] uppercase tracking-wider text-muted">Wallet</span>
            <span className="mono text-xs text-fg">
              {status.wallet?.slice(0, 6)}…{status.wallet?.slice(-6)}
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-border/50 pb-2">
            <span className="mono text-[10px] uppercase tracking-wider text-muted">$0C held</span>
            <span className="mono text-xs text-fg">
              {cfg.gateConfigured ? Math.floor(status.balance ?? 0).toLocaleString() : "— (token not live)"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="mono text-[10px] uppercase tracking-wider text-muted">Access</span>
            <span className={`mono text-xs ${tierColor}`}>{tierLabel}</span>
          </div>
        </div>
      ) : code ? (
        /* code issued — waiting for the tweet */
        <div className="mt-4">
          <div className="mono mb-1 block text-[10px] uppercase tracking-wider text-muted">
            Step 2 · post this from your X account
          </div>
          <div className="flex items-center gap-2">
            <code className="mono flex-1 rounded border border-border bg-black/40 px-3 py-2 text-sm text-accent">
              {code}
            </code>
            <button
              className="btn btn-ghost !py-1.5"
              onClick={() => {
                navigator.clipboard?.writeText(tweetText);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              {copied ? "copied ✓" : "copy"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a className="btn btn-accent" href={intentUrl} target="_blank" rel="noreferrer" style={{ textTransform: "none" }}>
              Post on X ↗
            </a>
            <button className="btn btn-ghost" onClick={loadStatus}>
              I&apos;VE POSTED — CHECK
            </button>
          </div>
          <p className="mono mt-2 text-[11px] text-muted">
            Posting the code from your account is what proves you control it — a pasted address alone
            proves nothing.
          </p>
        </div>
      ) : (
        /* nothing yet */
        <div className="mt-4">
          <div className="mono mb-2 block text-[10px] uppercase tracking-wider text-muted">
            Step 1 · connect the wallet holding your $0C
          </div>
          <button className="btn btn-accent" onClick={startLink} disabled={busy}>
            {phase === "connecting" ? "CONNECTING…" : phase === "creating" ? "CREATING CODE…" : "CONNECT WALLET"}
          </button>
        </div>
      )}

      {msg && <div className="mono mt-3 text-xs text-warn">⚠ {msg}</div>}
    </div>
  );
}
