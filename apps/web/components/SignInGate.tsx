"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";

export function SignInGate({ title }: { title: string }) {
  const { login } = useAuth();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function go() {
    const id = name.trim();
    if (!id) return;
    setBusy(true);
    try {
      await login(id);
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="card relative w-full max-w-sm p-8 text-center">
        <span className="corner corner-tl !h-4 !w-4" />
        <span className="corner corner-br !h-4 !w-4" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-128.png" alt="0_C" className="floaty mx-auto mb-4 h-14 w-14 object-contain" />
        <h2 className="mono text-lg font-semibold tracking-wide">{title}</h2>
        <p className="mt-2 text-sm text-muted">
          Pick any username to get a dev identity and a starter credit grant. (Privy wallet auth
          drops in here later.)
        </p>
        <div className="mt-5 flex gap-2">
          <input
            className="input"
            placeholder="username"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
          />
          <button className="btn btn-primary" onClick={go} disabled={busy}>
            {busy ? "…" : "ENTER"}
          </button>
        </div>
      </div>
    </div>
  );
}
