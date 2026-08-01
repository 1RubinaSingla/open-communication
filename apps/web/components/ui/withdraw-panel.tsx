"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { ORCH_URL } from "@/lib/config";
import { explorerTx } from "@/lib/solana";

interface WithdrawConfig {
  enabled: boolean;
  currency: string;
  min: number;
  maxPerRequest: number;
  maxPerDay: number;
  solUsdPrice: number;
}
interface Row {
  id: string;
  credits: number;
  amount: number;
  currency: string;
  address: string;
  status: string;
  signature: string | null;
}

type Phase = "idle" | "sending" | "done" | "error";

export function WithdrawPanel({ cluster = "mainnet-beta" }: { cluster?: string }) {
  const { session, refresh, balance } = useAuth();
  const [cfg, setCfg] = useState<WithdrawConfig | null>(null);
  const [amount, setAmount] = useState("500");
  const [address, setAddress] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [withdrawable, setWithdrawable] = useState<number | null>(null);

  const loadHistory = useCallback(async () => {
    if (!session) return;
    try {
      const r = await fetch(`${ORCH_URL}/withdrawals`, { headers: { Authorization: `Bearer ${session.token}` } }).then((x) => x.json());
      setRows(r.withdrawals ?? []);
      if (typeof r.withdrawable === "number") setWithdrawable(r.withdrawable);
      // convenience: default the payout address to the linked wallet
      const me = await fetch(`${ORCH_URL}/me`, { headers: { Authorization: `Bearer ${session.token}` } }).then((x) => x.json());
      if (me.wallet) setAddress((cur) => cur || me.wallet);
    } catch {
      /* ignore */
    }
  }, [session]);

  useEffect(() => {
    fetch(`${ORCH_URL}/withdrawals/config`).then((r) => r.json()).then(setCfg).catch(() => {});
    loadHistory();
  }, [loadHistory]);

  if (!cfg || !cfg.enabled) return null;

  const credits = Math.floor(Number(amount) || 0);
  const usd = credits / 100;
  const sol = cfg.solUsdPrice > 0 ? usd / cfg.solUsdPrice : 0;

  async function withdraw() {
    if (!session) return;
    setMsg("");
    setSig(null);
    setPhase("sending");
    try {
      const res = await fetch(`${ORCH_URL}/withdrawals`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ credits, address: address.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPhase("error");
        setMsg(`${data.error}${data.refunded ? " (credits refunded)" : data.status === "review" ? " (under review — not refunded)" : ""}`);
      } else {
        setPhase("done");
        setSig(data.signature);
        setMsg(`Paid ${Number(data.amount).toFixed(4)} SOL · balance ${data.balance}`);
      }
      await refresh();
      await loadHistory();
    } catch (e) {
      setPhase("error");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  const busy = phase === "sending";

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="mono text-sm font-semibold tracking-wide">WITHDRAW · SOL</h2>
        <span className="pill">auto · capped</span>
      </div>

      <div className="mb-2">
        <label className="mono mb-1 block text-[10px] uppercase tracking-wider text-muted">Solana address (recipient)</label>
        <input className="input" placeholder="your wallet address" value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="mono mb-1 block text-[10px] uppercase tracking-wider text-muted">Amount (credits)</label>
          <input className="input" type="number" min={cfg.min} step="100" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <button
          className="btn btn-accent"
          onClick={withdraw}
          disabled={busy || credits < cfg.min || !address.trim() || credits > (withdrawable ?? balance)}
        >
          {busy ? "PAYING…" : "WITHDRAW"}
        </button>
      </div>
      <div className="mono mt-2 text-[11px] text-muted">
        ≈ {sol.toFixed(4)} SOL (${usd.toFixed(2)}) · min {cfg.min} · max {cfg.maxPerRequest}/req · {cfg.maxPerDay}/day
      </div>
      {withdrawable !== null && (
        <div className="mono mt-1 text-[11px] text-muted">
          withdrawable <span className="text-fg">{withdrawable}</span> of {balance} cr
          {withdrawable < balance && " · promotional credits can be spent but not cashed out"}
        </div>
      )}

      {msg && (
        <div className={`mono mt-3 text-xs ${phase === "error" ? "text-warn" : "text-good"}`}>
          {phase === "error" ? "⚠ " : "✓ "}
          {msg}
          {sig && (
            <>
              {" · "}
              <a className="underline" href={explorerTx(sig, cluster)} target="_blank" rel="noreferrer">view tx</a>
            </>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-border pt-3">
          {rows.slice(0, 4).map((w) => (
            <div key={w.id} className="mono flex items-center justify-between text-[11px] text-muted">
              <span>{Number(w.amount).toFixed(4)} {w.currency} → {w.address.slice(0, 4)}…{w.address.slice(-4)}</span>
              <span className={w.status === "paid" ? "text-good" : w.status === "review" ? "text-warn" : "text-muted"}>{w.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
