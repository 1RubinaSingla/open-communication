"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { ORCH_URL } from "@/lib/config";
import { SignInGate } from "@/components/SignInGate";

interface StakeInfo {
  staked: number;
  pending: number;
  totalStaked: number;
  lifetimeRewards: number;
  balance: number;
}

export default function StakingPage() {
  const { session, refresh } = useAuth();
  const [info, setInfo] = useState<StakeInfo | null>(null);
  const [amount, setAmount] = useState("100");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    if (!session) return;
    const r = await fetch(`${ORCH_URL}/staking`, {
      headers: { Authorization: `Bearer ${session.token}` },
    }).then((x) => x.json());
    setInfo(r);
  }, [session]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function act(path: string, body?: object) {
    if (!session) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(`${ORCH_URL}/staking/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify(body ?? {}),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "failed");
      setInfo((prev) => ({ ...(prev as StakeInfo), ...data }));
      if (data.claimed !== undefined) setMsg(data.claimed > 0 ? `Claimed ${data.claimed} credits` : "No rewards to claim yet");
      await refresh();
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!session) return <SignInGate title="Sign in to stake" />;

  const amt = Math.floor(Number(amount) || 0);
  const stat = (label: string, value: string | number) => (
    <div className="card p-5">
      <div className="mono text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mono mt-2 text-3xl font-semibold">{value}</div>
    </div>
  );

  return (
    <div className="space-y-6 py-6">
      <div className="flex items-center gap-3">
        <h1 className="mono text-xl font-semibold tracking-wide">STAKING</h1>
        <span className="pill">reward-per-share</span>
      </div>
      <p className="max-w-2xl text-sm text-muted">
        Lock credits to earn a share of every settled job on the network. A slice of each job's
        charge flows to the staking pool and is distributed to stakers in proportion to their stake.
      </p>

      <div className="grid gap-4 md:grid-cols-4">
        {stat("Your stake", info?.staked ?? 0)}
        {stat("Pending rewards", info?.pending ?? 0)}
        {stat("Network staked", info?.totalStaked ?? 0)}
        {stat("Lifetime pool", info?.lifetimeRewards ?? 0)}
      </div>

      <div className="card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="mono text-sm font-semibold tracking-wide">MANAGE</h2>
          <span className="mono text-xs text-muted">balance {info?.balance ?? 0} cr</span>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="mono mb-1 block text-[10px] uppercase tracking-wider text-muted">
              Amount (credits)
            </label>
            <input
              className="input"
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <button className="btn btn-accent" disabled={busy || amt <= 0} onClick={() => act("stake", { amount: amt })}>
            STAKE
          </button>
          <button className="btn btn-ghost" disabled={busy || amt <= 0} onClick={() => act("unstake", { amount: amt })}>
            UNSTAKE
          </button>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button className="btn btn-primary" disabled={busy || !info?.pending} onClick={() => act("claim")}>
            CLAIM {info?.pending ? `${info.pending} CR` : "REWARDS"}
          </button>
          {msg && <span className="mono text-xs text-muted">{msg}</span>}
        </div>
      </div>
    </div>
  );
}
