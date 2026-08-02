"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { ORCH_URL } from "@/lib/config";
import { signWalletChallenge } from "@/lib/eth";

type Phase = "idle" | "signing" | "saving" | "error";

/**
 * Optional wallet link. Not required to use 0_C — it just lets the app remember
 * your address for deposits, withdrawals and $0C holder checks. Ownership is
 * proven by signing a challenge, so a linked wallet can be trusted.
 */
export function WalletPanel() {
  const { session } = useAuth();
  const [wallet, setWallet] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const me = await fetch(`${ORCH_URL}/me`, {
        headers: { Authorization: `Bearer ${session.token}` },
      }).then((r) => r.json());
      setWallet(me.wallet ?? null);
    } catch {
      /* offline */
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  async function connect() {
    if (!session) return;
    setMsg("");
    try {
      setPhase("signing");
      const ch = await fetch(`${ORCH_URL}/me/wallet/challenge`, {
        headers: { Authorization: `Bearer ${session.token}` },
      }).then((r) => r.json());
      const signed = await signWalletChallenge(ch.message);

      setPhase("saving");
      const res = await fetch(`${ORCH_URL}/me/wallet`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ ...signed, issuedAt: ch.issuedAt }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "could not link wallet");
      setPhase("idle");
      setWallet(data.wallet);
    } catch (e) {
      setPhase("error");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function disconnect() {
    if (!session) return;
    await fetch(`${ORCH_URL}/me/wallet`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.token}` },
    });
    setWallet(null);
    setMsg("");
  }

  const busy = phase === "signing" || phase === "saving";

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="mono text-sm font-semibold tracking-wide">WALLET</h2>
        <span className="pill">{wallet ? "linked" : "optional"}</span>
      </div>

      {wallet ? (
        <>
          <div className="mono break-all text-xs text-fg">{wallet}</div>
          <p className="mt-2 text-xs text-muted">
            Ownership verified by signature. Used to pre-fill deposits and withdrawals, and to check
            $0C holdings.
          </p>
          <button className="btn btn-ghost mt-3" onClick={disconnect}>
            DISCONNECT
          </button>
        </>
      ) : (
        <>
          <p className="text-xs text-muted">
            Optional. Link a wallet so the app remembers your address for deposits, withdrawals and
            $0C holder checks. You&apos;ll sign a short message — it authorises no transaction and
            cannot move funds.
          </p>
          <button className="btn btn-accent mt-3" onClick={connect} disabled={busy}>
            {phase === "signing" ? "SIGN IN WALLET…" : phase === "saving" ? "LINKING…" : "CONNECT WALLET"}
          </button>
        </>
      )}

      {msg && <div className="mono mt-3 text-xs text-warn">⚠ {msg}</div>}
    </div>
  );
}
