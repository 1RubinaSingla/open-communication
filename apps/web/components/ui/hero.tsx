"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ORCH_URL } from "@/lib/config";
import { AsciiBackground } from "@/components/ui/ascii-background";
import { Counter, Scramble } from "@/components/ui/motion";

interface Stats {
  workerCount: number;
  online: number;
  totalTokensPerSec: number;
  verifiedMath?: boolean;
  searchProvider?: string | null;
}

/** The stack, stated in the words people search for. */
const BADGES = [
  "LEAN 4 · MACHINE-CHECKED",
  "X25519 · XCHACHA20",
  "ED25519 ATTESTED",
  "SOLANA SETTLED",
];

export function Hero() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${ORCH_URL}/stats`)
        .then((r) => r.json())
        .then((s) => alive && setStats(s))
        .catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <section className="relative -mx-4 flex min-h-[calc(100vh-4rem)] items-center overflow-hidden bg-black">
      {/* Animated ASCII field — bends toward the cursor */}
      <div className="absolute inset-0">
        <AsciiBackground className="h-full w-full" />
      </div>
      {/* Readability scrim. On mobile the copy spans the full width, so the
          field has to be damped much further right than on desktop. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black via-black/85 to-black/55 md:via-black/75 md:to-black/25" />
      {/* accent bloom behind the headline */}
      <div
        className="breathe pointer-events-none absolute -left-40 top-1/3 h-[34rem] w-[34rem] rounded-full"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--accent) 12%, transparent), transparent 65%)",
        }}
      />

      {/* Corner frame accents */}
      <span className="corner corner-tl" />
      <span className="corner corner-tr" />
      <span className="corner corner-bl" />
      <span className="corner corner-br" />

      {/* Content */}
      {/* py leaves room for the fixed status strip at the bottom of the section */}
      <div className="relative z-10 w-full px-6 py-20 sm:py-24 lg:px-12">
        <div className="max-w-3xl">
          {/* top decorative line */}
          <div className="mb-4 flex items-center gap-2 opacity-70">
            <div className="h-px w-8 bg-white" />
            <span className="mono text-[10px] tracking-widest text-white">∞</span>
            <span className="mono text-[10px] tracking-widest text-white/60">
              OPEN.COMMUNICATION // 0_C
            </span>
            <div className="h-px flex-1 bg-white/30" />
          </div>

          <h1 className="mono text-[2rem] font-bold leading-[1.06] tracking-tight text-white sm:text-6xl">
            <span className="gradient-text">
              <Scramble text="COMPUTE" speed={40} />
            </span>
            <span className="text-white/40"> // </span>
            <span className="gradient-text">
              <Scramble text="CONVERSATION" speed={40} startDelay={180} />
            </span>
            <span className="text-white/40"> // </span>
            <span className="gradient-text">
              <Scramble text="PROOF" speed={40} startDelay={420} />
            </span>
            <br />
            <span className="text-white">OWNED BY NO ONE.</span>
          </h1>

          {/* dotted rule */}
          <div className="my-5 flex gap-1 opacity-40">
            {Array.from({ length: 48 }).map((_, i) => (
              <div key={i} className="h-0.5 w-0.5 rounded-full bg-white" />
            ))}
          </div>

          <p className="mono max-w-2xl text-sm leading-relaxed text-gray-400">
            Uncensored AI inference, end-to-end encrypted messaging, and{" "}
            <span className="text-accent">formally verified mathematics</span> — served on GPUs that
            people contribute, not corporate data centers. When the network proves something, it
            proves it in <span className="text-fg">Lean 4</span> via{" "}
            <span className="text-fg">Harmonic&apos;s Aristotle</span>, then signs the result so you
            can check it yourself.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {BADGES.map((b, i) => (
              <span key={b} className="chip chip-in" style={{ animationDelay: `${600 + i * 90}ms` }}>
                {b}
              </span>
            ))}
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/chat" className="btn btn-primary group">
              <span>ENTER NETWORK</span>
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </Link>
            <Link href="/proof/dcac4a4c" className="btn btn-accent">
              SEE A SIGNED PROOF
            </Link>
            <Link href="/contribute" className="btn btn-ghost">
              CONTRIBUTE GPU
            </Link>
          </div>

          <div className="mt-6 flex items-center gap-2 opacity-40">
            <span className="mono text-[9px] text-white">∞</span>
            <div className="h-px flex-1 bg-white" />
            <span className="mono text-[9px] text-white">POWERED BY $0C · 1B SUPPLY</span>
          </div>
        </div>
      </div>

      {/* Bottom system-notation strip */}
      <div className="absolute bottom-0 left-0 right-0 z-20 border-t border-border bg-black/60 backdrop-blur-sm">
        <div className="flex items-center justify-between px-4 py-2 lg:px-8 lg:py-3">
          <div className="mono flex items-center gap-3 text-[9px] text-white/50 lg:gap-6">
            <span className="dot live ping relative inline-block" />
            <span>SYSTEM.ACTIVE</span>
            <div className="hidden gap-1 lg:flex">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="w-1 bg-accent/40"
                  style={{
                    height: `${4 + ((i * 37) % 12)}px`,
                    animation: `breathe ${2.2 + i * 0.23}s ease-in-out ${i * 0.11}s infinite`,
                  }}
                />
              ))}
            </div>
            <span>
              NODES:
              <Counter value={stats?.workerCount ?? 0} className="text-accent" />
            </span>
            <span className="hidden lg:inline">
              TOK/S:
              <Counter value={stats?.totalTokensPerSec ?? 0} className="text-accent" />
            </span>
            {stats?.verifiedMath ? (
              <span className="hidden text-good lg:inline">VERIFIED-MATH:ONLINE</span>
            ) : null}
          </div>
          <div className="mono flex items-center gap-2 text-[9px] text-white/50 lg:gap-4">
            <span className="hidden lg:inline">◐ ROUTING</span>
            <div className="flex gap-1">
              <div className="h-1 w-1 animate-pulse rounded-full bg-white/60" />
              <div
                className="h-1 w-1 animate-pulse rounded-full bg-white/40"
                style={{ animationDelay: "0.2s" }}
              />
              <div
                className="h-1 w-1 animate-pulse rounded-full bg-white/20"
                style={{ animationDelay: "0.4s" }}
              />
            </div>
            <span>V0.1.0</span>
          </div>
        </div>
      </div>
    </section>
  );
}
