"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { creditsToUsd } from "@0c/credits";

const LINKS = [
  { href: "/chat", label: "CHAT" },
  { href: "/create", label: "CREATE" },
  { href: "/messages", label: "MESSAGES" },
  { href: "/staking", label: "STAKE" },
  { href: "/dashboard", label: "DASHBOARD" },
  { href: "/contribute", label: "CONTRIBUTE" },
  { href: "/whitepaper", label: "WHITEPAPER" },
  { href: "/contact", label: "CONTACT" },
];

export function Nav() {
  const path = usePathname();
  const { session, balance, login, logout, ready } = useAuth();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleLogin() {
    const id = name.trim();
    if (!id) return;
    setBusy(true);
    try {
      await login(id);
      setName("");
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-black/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-128.png" alt="0_C" className="h-8 w-8 object-contain" />
          <span className="mono hidden text-xs tracking-widest text-white/80 sm:inline">
            OPEN&nbsp;COMMUNICATION
          </span>
        </Link>

        <nav className="ml-2 hidden items-center gap-1 md:flex">
          {LINKS.map((l) => {
            const active = path === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`mono rounded-sm px-3 py-1.5 text-[11px] tracking-wider transition ${
                  active ? "border border-border bg-white/5 text-fg" : "border border-transparent text-muted hover:text-fg"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <a
            href="https://x.com/O_C_"
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost !py-1.5 whitespace-nowrap"
            style={{ textTransform: "none" }}
            title="Follow @O_C_ on X"
          >
            𝕏 @O_C_
          </a>
          {!ready ? null : session ? (
            <>
              <span className="pill" title="Credits balance (1 credit = $0.01)">
                <span className="dot live" />
                {balance}CR
                <span className="text-muted/60">${creditsToUsd(balance).toFixed(2)}</span>
              </span>
              <span className="mono hidden text-[11px] text-muted sm:inline">@{session.userId}</span>
              <button className="btn btn-ghost !py-1.5" onClick={logout}>
                EXIT
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <input
                className="input !w-36 !py-1.5"
                placeholder="username"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              />
              <button className="btn btn-primary !py-1.5" onClick={handleLogin} disabled={busy}>
                {busy ? "…" : "ENTER"}
              </button>
            </div>
          )}
        </div>
      </div>

      <nav className="flex items-center gap-1 overflow-x-auto border-t border-border px-4 py-2 md:hidden">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`mono whitespace-nowrap rounded-sm px-3 py-1 text-[11px] tracking-wider ${
              path === l.href ? "bg-white/5 text-fg" : "text-muted"
            }`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
