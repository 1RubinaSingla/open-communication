"use client";

import { useEffect, useState } from "react";
import { useInView, usePrefersReducedMotion } from "@/components/ui/motion";

type Kind = "cmd" | "info" | "ok" | "warn" | "out";

interface Line {
  kind: Kind;
  text: string;
  /** extra pause after this line, ms — used to pace the "thinking" beats */
  hold?: number;
}

/**
 * A replay of run dcac4a4c — the same pipeline every verified-maths job runs:
 * pre-filter → run marker → Harmonic Aristotle → Lean 4 → axiom audit → signed
 * attestation. Labelled as a replay; the signed record and full transcript are
 * linked from the section around it.
 */
const LINES: Line[] = [
  { kind: "cmd", text: "0c verify --model aristotle-1 --attest", hold: 260 },
  { kind: "info", text: "pre-filter    ok · statement is a formalisable proposition" },
  { kind: "info", text: "run marker    dcac4a4c · sha256(prompt)=9f4c…21ab" },
  { kind: "warn", text: "⚠ leaves network → harmonic aristotle /api/v3", hold: 340 },
  { kind: "out", text: "project       e33ca845 · mode=INSTRUCT" },
  { kind: "out", text: "agent_tasks   formalising statement in Lean 4…", hold: 460 },
  { kind: "out", text: "agent_tasks   constructing relay-view argument…", hold: 460 },
  { kind: "out", text: "lake build    OpenCommunication.relay_privacy", hold: 380 },
  { kind: "ok", text: "✓ build       0 errors · 0 warnings" },
  { kind: "ok", text: "✓ audit       no `sorry` · no `admit` · no new axioms" },
  { kind: "info", text: "attest        ed25519 sign(0c-attest-v1|dcac4a4c|…)" },
  { kind: "ok", text: "✓ VERIFIED    machine-checked · signature published", hold: 2600 },
];

const COLOR: Record<Kind, string> = {
  cmd: "text-fg",
  info: "text-muted",
  ok: "text-good",
  warn: "text-warn",
  out: "text-accent-2",
};

export function ProofTerminal() {
  const reduced = usePrefersReducedMotion();
  // Only starts once it's actually on screen — no work for a section nobody sees.
  const { ref: hostRef, inView } = useInView<HTMLDivElement>();
  const [shown, setShown] = useState<Line[]>([]);
  const [typing, setTyping] = useState("");

  // Reduced motion: show the finished log immediately, no typing.
  useEffect(() => {
    if (reduced) setShown(LINES);
  }, [reduced]);

  useEffect(() => {
    if (reduced || !inView) return;
    let cancelled = false;
    const timers: number[] = [];
    const wait = (ms: number) =>
      new Promise<void>((res) => timers.push(window.setTimeout(res, ms)));

    (async () => {
      while (!cancelled) {
        setShown([]);
        for (const line of LINES) {
          if (cancelled) return;
          // Commands type out character by character; log output lands whole,
          // which is how a real terminal behaves.
          if (line.kind === "cmd") {
            for (let i = 1; i <= line.text.length; i++) {
              if (cancelled) return;
              setTyping(line.text.slice(0, i));
              await wait(26);
            }
            setTyping("");
          } else {
            await wait(150);
          }
          if (cancelled) return;
          setShown((s) => [...s, line]);
          await wait(line.hold ?? 120);
        }
        await wait(1200);
      }
    })();

    return () => {
      cancelled = true;
      timers.forEach(window.clearTimeout);
    };
  }, [reduced, inView]);

  return (
    <div ref={hostRef} className="card scanlines overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-white/20" />
        <span className="h-2 w-2 rounded-full bg-white/20" />
        <span className="h-2 w-2 rounded-full bg-white/20" />
        <span className="mono ml-2 text-[10px] tracking-widest text-muted">
          0_C · VERIFIED-MATHS PIPELINE
        </span>
        <span className="pill ml-auto !text-[9px]">replay · run dcac4a4c</span>
      </div>

      <div className="mono relative min-h-[19rem] space-y-1 p-4 text-[11.5px] leading-relaxed sm:text-xs">
        {shown.map((l, i) => (
          <div key={`${i}-${l.text}`} className={`flex gap-2 ${COLOR[l.kind]}`}>
            <span className="select-none text-muted/40">{l.kind === "cmd" ? "$" : " "}</span>
            <span className="whitespace-pre-wrap break-words">{l.text}</span>
          </div>
        ))}
        {typing && (
          <div className="flex gap-2 text-fg">
            <span className="select-none text-muted/40">$</span>
            <span className="caret">{typing}</span>
          </div>
        )}
      </div>
    </div>
  );
}
