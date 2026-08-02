"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);

  // The bar is translucent over the hero and firms up once you scroll; the
  // hairline underneath doubles as a page-progress indicator.
  useEffect(() => {
    let ticking = false;
    const measure = () => {
      ticking = false;
      const y = window.scrollY;
      setScrolled(y > 8);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, y / max) : 0);
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(measure);
    };
    // rAF is suspended while the tab is hidden, so a tab restored mid-page would
    // keep the transparent top-of-page styling. Re-measure directly on wake.
    const onVisible = () => document.visibilityState === "visible" && measure();

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

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
    <header
      className={`sticky top-0 z-40 border-b transition-colors duration-300 ${
        scrolled
          ? "border-border bg-black/85 backdrop-blur-xl"
          : "border-transparent bg-black/40 backdrop-blur-md"
      }`}
    >
      <div className="flex h-16 items-center gap-5 px-5 lg:px-8">
        <Link href="/" className="group flex shrink-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-128.png"
            alt="0_C"
            className="h-9 w-9 object-contain transition-transform duration-300 group-hover:scale-110"
          />
          <span className="mono hidden text-[13px] tracking-[0.18em] text-white/85 transition-colors group-hover:text-white xl:inline">
            OPEN&nbsp;COMMUNICATION
          </span>
        </Link>

        <nav className="hidden items-center lg:flex">
          {LINKS.map((l) => {
            const active = path === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`mono group relative px-3.5 py-2 text-[12.5px] tracking-wider transition-colors ${
                  active ? "text-fg" : "text-muted hover:text-fg"
                }`}
              >
                {l.label}
                {/* underline slides open on hover, stays open on the active page */}
                <span
                  className={`absolute inset-x-3 bottom-0 h-px origin-center bg-accent transition-transform duration-300 ${
                    active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"
                  }`}
                />
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          <a
            href="https://x.com/O_C_"
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost !py-1.5 !text-[12px] whitespace-nowrap"
            style={{ textTransform: "none" }}
            title="Follow @O_C_ on X"
          >
            𝕏 @O_C_
          </a>
          {!ready ? null : session ? (
            <>
              <span className="pill !text-[11px]" title="Credits balance (1 credit = $0.01)">
                <span className="dot live" />
                {balance}CR
                <span className="text-muted/60">${creditsToUsd(balance).toFixed(2)}</span>
              </span>
              <span className="mono hidden text-[12px] text-muted lg:inline">
                @{session.userId}
              </span>
              <button className="btn btn-ghost !py-1.5 !text-[12px]" onClick={logout}>
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
              <button
                className="btn btn-primary !py-1.5 !text-[12px]"
                onClick={handleLogin}
                disabled={busy}
              >
                {busy ? "…" : "ENTER"}
              </button>
            </div>
          )}
        </div>
      </div>

      <nav className="no-scrollbar flex items-center gap-1 overflow-x-auto border-t border-border px-5 py-2 lg:hidden">
        {LINKS.map((l) => {
          const active = path === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`mono whitespace-nowrap rounded-sm border px-3 py-1.5 text-[12px] tracking-wider transition-colors ${
                active
                  ? "border-[color:color-mix(in_srgb,var(--accent)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_10%,transparent)] text-accent"
                  : "border-transparent text-muted"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>

      {/* page-scroll progress — rides on the header's own bottom edge */}
      <div className="pointer-events-none absolute inset-x-0 -bottom-px h-[2px] overflow-hidden">
        <div
          className="h-full origin-left bg-gradient-to-r from-accent to-accent-2 transition-transform duration-100 ease-out"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
    </header>
  );
}
