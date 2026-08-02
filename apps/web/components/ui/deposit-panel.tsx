"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { ORCH_URL } from "@/lib/config";
import {
  connectWallet,
  depositEth,
  depositUsdt,
  explorerTx,
  explorerAddress,
  waitForTx,
} from "@/lib/eth";

interface DepositConfig {
  enabled: boolean;
  chain: string;
  ethUsdPrice: number;
  usdtAddress: string;
  confirmations: number;
}

type Phase = "idle" | "connecting" | "sending" | "mining" | "verifying" | "done" | "error";
type Currency = "ETH" | "USDT";

export function DepositPanel() {
  const { session, refresh } = useAuth();
  const [cfg, setCfg] = useState<DepositConfig | null>(null);
  const [depositAddress, setDepositAddress] = useState<string | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Currency>("ETH");
  const [amount, setAmount] = useState("0.01");
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState("");
  const [hash, setHash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`${ORCH_URL}/credits/config`)
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => {});
  }, []);

  // The account's own deposit address — this is what binds a payment to you,
  // so it has to be fetched before anything can be sent.
  const loadAddress = useCallback(async () => {
    if (!session) return;
    try {
      const r = await fetch(`${ORCH_URL}/credits/deposit-address`, {
        headers: { Authorization: `Bearer ${session.token}` },
      }).then((x) => x.json());
      if (r.address) setDepositAddress(r.address);
    } catch {
      /* offline */
    }
  }, [session]);

  useEffect(() => {
    loadAddress();
  }, [loadAddress]);

  if (!cfg || !cfg.enabled) return null;

  const amt = Number(amount) || 0;
  const usd = currency === "ETH" ? amt * cfg.ethUsdPrice : amt;
  const estCredits = Math.floor(usd * 100);

  function pickCurrency(c: Currency) {
    setCurrency(c);
    setAmount(c === "ETH" ? "0.01" : "25");
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

  async function copyAddress() {
    if (!depositAddress) return;
    await navigator.clipboard.writeText(depositAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function deposit() {
    if (!session || !cfg || !depositAddress) return;
    setMsg("");
    setHash(null);
    try {
      setPhase("sending");
      const sent =
        currency === "ETH"
          ? await depositEth({ chain: cfg.chain, depositAddress, amountEth: amt })
          : await depositUsdt({
              chain: cfg.chain,
              depositAddress,
              usdtAddress: cfg.usdtAddress,
              amountUsdt: amt,
            });
      setHash(sent.hash);

      // The server won't credit until the transaction has enough confirmations,
      // so wait for it to be mined before asking.
      setPhase("mining");
      await waitForTx(cfg.chain, sent.hash);

      setPhase("verifying");
      const res = await fetch(`${ORCH_URL}/credits/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ txHash: sent.hash }),
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

  const busy =
    phase === "sending" || phase === "mining" || phase === "verifying" || phase === "connecting";

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="mono text-sm font-semibold tracking-wide">ADD CREDITS</h2>
        <span className="pill">{cfg.chain}</span>
      </div>

      {/* currency toggle */}
      <div className="mb-3 flex gap-1">
        {(["ETH", "USDT"] as Currency[]).map((c) => (
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
          {phase === "connecting" ? "CONNECTING…" : "CONNECT WALLET"}
        </button>
      ) : (
        <>
          <div className="mono mb-3 truncate text-[11px] text-muted">
            wallet {wallet.slice(0, 6)}…{wallet.slice(-4)}
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
                step={currency === "ETH" ? "0.001" : "1"}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <button
              className="btn btn-accent"
              onClick={deposit}
              disabled={busy || amt <= 0 || !depositAddress}
            >
              {phase === "sending"
                ? "SIGN IN WALLET…"
                : phase === "mining"
                  ? "MINING…"
                  : phase === "verifying"
                    ? "VERIFYING…"
                    : "DEPOSIT"}
            </button>
          </div>
          <div className="mono mt-2 text-[11px] text-muted">
            ≈ {estCredits} credits (${usd.toFixed(2)}
            {currency === "ETH" ? ` @ $${cfg.ethUsdPrice.toFixed(2)}/ETH` : ""}) · credited after{" "}
            {cfg.confirmations} confirmations
          </div>
        </>
      )}

      {msg && (
        <div className={`mono mt-3 text-xs ${phase === "error" ? "text-warn" : "text-good"}`}>
          {phase === "error" ? "⚠ " : "✓ "}
          {msg}
          {hash && (
            <>
              {" · "}
              <a
                className="underline"
                href={explorerTx(hash, cfg.chain)}
                target="_blank"
                rel="noreferrer"
              >
                view tx
              </a>
            </>
          )}
        </div>
      )}

      <div className="mt-3 border-t border-border pt-3">
        <div className="mono mb-1 text-[10px] uppercase tracking-wider text-muted">
          Your deposit address
        </div>
        {depositAddress ? (
          <>
            <div className="mono break-all text-[11px] text-fg">{depositAddress}</div>
            <div className="mt-2 flex gap-2">
              <button className="btn btn-ghost !py-1" onClick={copyAddress}>
                {copied ? "COPIED" : "COPY"}
              </button>
              <a
                className="btn btn-ghost !py-1"
                href={explorerAddress(depositAddress, cfg.chain)}
                target="_blank"
                rel="noreferrer"
                style={{ textTransform: "none" }}
              >
                Etherscan ↗
              </a>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted/70">
              This address is yours alone — sending ETH or USDT to it is what credits your account.
              Send only on <span className="text-fg">{cfg.chain}</span>. Funds here are held by the
              service until swept.
            </p>
          </>
        ) : (
          <div className="mono text-[11px] text-muted">sign in to see your deposit address</div>
        )}
      </div>
    </div>
  );
}
