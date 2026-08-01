"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { ORCH_URL } from "@/lib/config";
import { creditsToUsd } from "@0c/credits";
import { SignInGate } from "@/components/SignInGate";
import { DepositPanel } from "@/components/ui/deposit-panel";
import { WithdrawPanel } from "@/components/ui/withdraw-panel";
import { XLinkPanel } from "@/components/ui/xlink-panel";
import { WalletPanel } from "@/components/ui/wallet-panel";

interface LedgerRow {
  id: string;
  delta: number;
  reason: string;
  source: string;
  ref: string | null;
  created_at: number;
}
interface WorkerStat {
  name: string;
  models: string[];
  runtime: string;
  busy: boolean;
  tokensPerSec: number;
  jobsServed: number;
}

const reasonColor: Record<string, string> = {
  grant: "text-good",
  earn: "text-good",
  refund: "text-muted",
  reserve: "text-warn",
  settle: "text-fg",
};

export default function DashboardPage() {
  const { session, balance, refresh } = useAuth();
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [workers, setWorkers] = useState<WorkerStat[]>([]);

  useEffect(() => {
    if (!session) return;
    const load = async () => {
      await refresh();
      try {
        const l = await fetch(`${ORCH_URL}/ledger`, { headers: { Authorization: `Bearer ${session.token}` } }).then((r) => r.json());
        setLedger(l.entries ?? []);
        const s = await fetch(`${ORCH_URL}/stats`).then((r) => r.json());
        setWorkers(s.workers ?? []);
      } catch {
        /* offline */
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (!session) return <SignInGate title="Sign in to view your dashboard" />;

  return (
    <div className="space-y-6 py-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card p-6">
          <div className="text-xs uppercase tracking-wider text-muted">Balance</div>
          <div className="mt-2 font-mono text-4xl font-semibold">{balance}</div>
          <div className="text-sm text-muted">credits · ${creditsToUsd(balance).toFixed(2)}</div>
        </div>
        <div className="card p-6">
          <div className="text-xs uppercase tracking-wider text-muted">Identity</div>
          <div className="mt-2 text-2xl font-semibold">@{session.userId}</div>
          <div className="text-sm text-muted">dev identity</div>
        </div>
        <div className="card p-6">
          <div className="text-xs uppercase tracking-wider text-muted">Network</div>
          <div className="mt-2 font-mono text-4xl font-semibold">{workers.length}</div>
          <div className="text-sm text-muted">workers connected</div>
        </div>
      </div>

      <WalletPanel />

      <div className="grid gap-4 lg:grid-cols-2">
        <DepositPanel />
        <WithdrawPanel />
      </div>

      <XLinkPanel />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ledger */}
        <div className="card p-5">
          <h2 className="mb-3 font-semibold">Credit ledger</h2>
          <div className="scroll-thin max-h-80 space-y-1 overflow-y-auto">
            {ledger.length === 0 && <p className="text-sm text-muted">No entries yet.</p>}
            {ledger.map((e) => (
              <div key={e.id} className="flex items-center justify-between border-b border-border/40 py-1.5 text-sm">
                <div>
                  <span className={reasonColor[e.reason] ?? "text-fg"}>{e.reason}</span>
                  <span className="ml-2 text-xs text-muted">{e.source}</span>
                </div>
                <div className={`font-mono ${e.delta >= 0 ? "text-good" : "text-fg"}`}>
                  {e.delta >= 0 ? "+" : ""}
                  {e.delta}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* workers */}
        <div className="card p-5">
          <h2 className="mb-3 font-semibold">Live workers</h2>
          <div className="scroll-thin max-h-80 space-y-2 overflow-y-auto">
            {workers.length === 0 && <p className="text-sm text-muted">No workers online. Start the native worker or open Contribute.</p>}
            {workers.map((w) => (
              <div key={w.name} className="flex items-center justify-between rounded-lg border border-border/50 bg-panel-2/50 px-3 py-2 text-sm">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    <span className={`dot ${w.busy ? "" : "live"}`} /> {w.name}
                  </div>
                  <div className="text-xs text-muted">
                    {w.runtime} · {w.models.join(", ")}
                  </div>
                </div>
                <div className="text-right text-xs text-muted">
                  <div className="font-mono text-fg">{w.tokensPerSec} tok/s</div>
                  <div>{w.jobsServed} served</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="mb-2 font-semibold">Use the API</h2>
        <p className="mb-3 text-sm text-muted">OpenAI-compatible. Your dev token is your API key.</p>
        <pre className="scroll-thin overflow-x-auto rounded-lg bg-black/40 p-4 text-xs leading-relaxed text-muted">
{`curl ${ORCH_URL}/v1/chat/completions \\
  -H "Authorization: Bearer ${session.token}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"echo","messages":[{"role":"user","content":"hi"}],"stream":true}'`}
        </pre>
      </div>
    </div>
  );
}
