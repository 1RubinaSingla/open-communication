"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ORCH_URL } from "@/lib/config";
import { AsciiBackground } from "@/components/ui/ascii-background";

interface Stats {
  workerCount: number;
  online: number;
  totalTokensPerSec: number;
}

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
    <section className="relative -mx-4 flex min-h-[calc(100vh-3.5rem)] items-center overflow-hidden bg-black">
      {/* Animated ASCII field */}
      <div className="absolute inset-0">
        <AsciiBackground className="h-full w-full" />
      </div>
      {/* readability scrim so hero copy stays legible over the field */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black via-black/70 to-black/30">
      </div>

      {/* Corner frame accents */}
      <span className="corner corner-tl" />
      <span className="corner corner-tr" />
      <span className="corner corner-bl" />
      <span className="corner corner-br" />

      {/* Content */}
      <div className="relative z-10 w-full px-6 lg:px-12">
        <div className="max-w-2xl">
          {/* top decorative line */}
          <div className="mb-4 flex items-center gap-2 opacity-70">
            <div className="h-px w-8 bg-white" />
            <span className="mono text-[10px] tracking-widest text-white">∞</span>
            <span className="mono text-[10px] tracking-widest text-white/60">
              OPEN.COMMUNICATION // 0_C
            </span>
            <div className="h-px flex-1 bg-white/30" />
          </div>

          <h1 className="mono text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-6xl">
            <span className="gradient-text">COMPUTE</span>
            <span className="text-white/40"> // </span>
            <span className="gradient-text">CONVERSATION</span>
            <br />
            <span className="text-white">OWNED BY NO ONE.</span>
          </h1>

          {/* dotted rule */}
          <div className="my-5 flex gap-1 opacity-40">
            {Array.from({ length: 48 }).map((_, i) => (
              <div key={i} className="h-0.5 w-0.5 rounded-full bg-white" />
            ))}
          </div>

          <p className="mono max-w-xl text-sm leading-relaxed text-gray-400">
            Uncensored AI inference AND end-to-end encrypted messaging, served on GPUs that people
            contribute — not corporate data centers. One network. Two ways to talk: to a model, and
            to each other.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/chat" className="btn btn-primary group">
              <span>ENTER NETWORK</span>
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
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
      <div className="absolute bottom-0 left-0 right-0 z-20 border-t border-border bg-black/50 backdrop-blur-sm">
        <div className="flex items-center justify-between px-4 py-2 lg:px-8 lg:py-3">
          <div className="flex items-center gap-3 mono text-[9px] text-white/50 lg:gap-6">
            <span className="dot live inline-block" />
            <span>SYSTEM.ACTIVE</span>
            <div className="hidden gap-1 lg:flex">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="w-1 bg-white/30"
                  style={{ height: `${4 + ((i * 37) % 12)}px` }}
                />
              ))}
            </div>
            <span>NODES:{stats?.workerCount ?? 0}</span>
            <span className="hidden lg:inline">TOK/S:{stats?.totalTokensPerSec ?? 0}</span>
          </div>
          <div className="flex items-center gap-2 mono text-[9px] text-white/50 lg:gap-4">
            <span className="hidden lg:inline">◐ ROUTING</span>
            <div className="flex gap-1">
              <div className="h-1 w-1 animate-pulse rounded-full bg-white/60" />
              <div className="h-1 w-1 animate-pulse rounded-full bg-white/40" style={{ animationDelay: "0.2s" }} />
              <div className="h-1 w-1 animate-pulse rounded-full bg-white/20" style={{ animationDelay: "0.4s" }} />
            </div>
            <span>V0.1.0</span>
          </div>
        </div>
      </div>
    </section>
  );
}
