"use client";

import { createContext, useContext, useCallback, useEffect, useState } from "react";
import { ORCH_URL } from "./config";

interface Session {
  userId: string;
  token: string;
}

interface AuthState {
  session: Session | null;
  balance: number;
  ready: boolean;
  login: (userId: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const KEY = "0c-session";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [balance, setBalance] = useState(0);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as Session;
    try {
      const res = await fetch(`${ORCH_URL}/me`, { headers: { Authorization: `Bearer ${s.token}` } });
      if (res.ok) {
        const data = await res.json();
        setBalance(data.balance);
      }
    } catch {
      /* orchestrator may be offline; keep session */
    }
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Session;
      setSession(s);
      void refresh();
    }
    setReady(true);
  }, [refresh]);

  const login = useCallback(async (userId: string) => {
    let res: Response;
    try {
      res = await fetch(`${ORCH_URL}/auth/dev`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
    } catch {
      throw new Error(`Can't reach the orchestrator at ${ORCH_URL}. Is it running / is NEXT_PUBLIC_ORCH_URL set?`);
    }
    // A non-JSON response means we hit the wrong host (e.g. the site itself) —
    // usually NEXT_PUBLIC_ORCH_URL is unset or wrong on this deployment.
    if (!res.headers.get("content-type")?.includes("application/json")) {
      throw new Error(
        `Orchestrator URL is misconfigured (got a non-JSON response from ${ORCH_URL}). Set NEXT_PUBLIC_ORCH_URL to your orchestrator's URL and redeploy.`,
      );
    }
    const data = await res.json();
    if (!data.ok) throw new Error(data.error ?? "login failed");
    const s: Session = { userId: data.userId, token: data.token };
    localStorage.setItem(KEY, JSON.stringify(s));
    setSession(s);
    setBalance(data.balance);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(KEY);
    setSession(null);
    setBalance(0);
  }, []);

  return (
    <Ctx.Provider value={{ session, balance, ready, login, logout, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
