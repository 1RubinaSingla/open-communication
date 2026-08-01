"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { ORCH_URL } from "@/lib/config";
import { connectWallet, depositSol, depositUsdc, explorerTx } from "@/lib/solana";

interface DepositConfig {
  enabled: boolean;
  cluster: string;
  treasury: string;
  solUsdPrice: number;
  usdcMint: string;
}

type Phase = "idle" | "connecting" | "sending" | "verifying" | "done" | "error";
type Currency = "SOL" | "USDC";

export function DepositPanel() {
  const { session, refresh } = useAuth();
  const [cfg, setCfg] = useState<DepositConfig | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Currency>("SOL");
  const [amount, setAmount] = useState("0.1");
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState("");
  const [sig, setSig] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${ORCH_URL}/credits/config`)
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => {});
  }, []);

  if (!cfg || !cfg.enabled) return null;

  const amt = Number(amount) || 0;
  const usd = currency === "SOL" ? amt * cfg.solUsdPrice : amt;
  const estCredits = Math.floor(usd * 100);

  function pickCurrency(c: Currency) {
    setCurrency(c);
    setAmount(c === "SOL" ? "0.1" : "5");
    setMsg("");
  }

  async function connect() {
    setMsg("");
    setPhase("connecting");
    try {
      setWallet(await connectWallet());
      setPhase("idle");
    } catch (e) {
      setPhase("error");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function deposit() {
    if (!session || !cfg) return;
    setMsg("");
    setSig(null);
    try {
      setPhase("sending");
      const { signature } =
        currency === "SOL"
          ? await depositSol({ cluster: cfg.cluster, treasury: cfg.treasury, amountSol: amt, userId: session.userId })
          : await depositUsdc({ cluster: cfg.cluster, treasury: cfg.treasury, usdcMint: cfg.usdcMint, amountUsdc: amt, userId: session.userId });
      setSig(signature);
      setPhase("verifying");
      const res = await fetch(`${ORCH_URL}/credits/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ signature }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "verification failed");
      setPhase("done");
      setMsg(`+${data.credits} credits · balance ${data.balance}`);
      await refresh();
    } catch (e) {
      setPhase("error");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  const busy = phase === "sending" || phase === "verifying" || phase === "connecting";

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="mono text-sm font-semibold tracking-wide">ADD CREDITS</h2>
        <span className="pill">{cfg.cluster}</span>
      </div>

      {/* currency toggle */}
      <div className="mb-3 flex gap-1">
        {(["SOL", "USDC"] as Currency[]).map((c) => (
          <button
            key={c}
            className={`btn !py-1.5 ${currency === c ? "btn-accent" : "btn-ghost"}`}
            onClick={() => pickCurrency(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {!wallet ? (
        <button className="btn btn-accent w-full" onClick={connect} disabled={busy}>
          {phase === "connecting" ? "CONNECTING…" : "CONNECT PHANTOM"}
        </button>
      ) : (
        <>
          <div className="mono mb-3 truncate text-[11px] text-muted">
            wallet {wallet.slice(0, 6)}…{wallet.slice(-6)}
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="mono mb-1 block text-[10px] uppercase tracking-wider text-muted">
                Amount ({currency})
              </label>
              <input
                className="input"
                type="number"
                min="0"
                step={currency === "SOL" ? "0.01" : "1"}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <button className="btn btn-accent" onClick={deposit} disabled={busy || amt <= 0}>
              {phase === "sending" ? "SIGN IN WALLET…" : phase === "verifying" ? "VERIFYING…" : "DEPOSIT"}
            </button>
          </div>
          <div className="mono mt-2 text-[11px] text-muted">
            ≈ {estCredits} credits (${usd.toFixed(2)}{currency === "SOL" ? ` @ $${cfg.solUsdPrice.toFixed(2)}/SOL` : ""})
          </div>
        </>
      )}

      {msg && (
        <div className={`mono mt-3 text-xs ${phase === "error" ? "text-warn" : "text-good"}`}>
          {phase === "error" ? "⚠ " : "✓ "}
          {msg}
          {sig && (
            <>
              {" · "}
              <a className="underline" href={explorerTx(sig, cfg.cluster)} target="_blank" rel="noreferrer">
                view tx
              </a>
            </>
          )}
        </div>
      )}

      <div className="mono mt-3 break-all border-t border-border pt-3 text-[10px] text-muted/70">
        treasury {cfg.treasury}
      </div>
    </div>
  );
}
