"use client";

import { useEffect, useRef } from "react";

/**
 * Self-contained animated ASCII background — a canvas plasma field rendered as
 * monospace glyphs. No external scripts, no CDN, CSP-safe. Sits behind hero
 * content at low opacity so text stays readable.
 */
const CHARS = " .·:-=+*#%@";

export function AsciiBackground({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const CELL = 12;
    let cols = 0;
    let rows = 0;
    let raf = 0;
    let t = 0;
    let last = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      const w = parent?.clientWidth ?? window.innerWidth;
      const h = parent?.clientHeight ?? window.innerHeight;
      canvas.width = w;
      canvas.height = h;
      cols = Math.ceil(w / CELL);
      rows = Math.ceil(h / CELL);
      ctx.font = "12px ui-monospace, 'JetBrains Mono', Menlo, monospace";
      ctx.textBaseline = "top";
    };
    resize();
    window.addEventListener("resize", resize);

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Pointer ripple: the field bends toward the cursor, so the backdrop feels
    // like a surface rather than a video. `px < 0` means "no pointer yet".
    let px = -1;
    let py = -1;
    let influence = 0;
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      px = (e.clientX - r.left) / CELL;
      py = (e.clientY - r.top) / CELL;
    };
    const onLeave = () => {
      px = -1;
      py = -1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 40) return; // ~25 fps — smooth enough to track a cursor
      last = now;
      if (!reduce) t += 0.028;

      // Ease the ripple in and out so entering/leaving isn't a hard cut.
      const target = px >= 0 && !reduce ? 1 : 0;
      influence += (target - influence) * 0.08;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cx = cols / 2;
      const cy = rows / 2;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          let v =
            Math.sin(x * 0.18 + t) +
            Math.sin(y * 0.22 - t * 0.8) +
            Math.sin((x + y) * 0.12 + t * 0.5) +
            Math.sin(Math.hypot(x - cx, y - cy) * 0.2 - t);

          let near = 0;
          if (influence > 0.01 && px >= 0) {
            const d = Math.hypot(x - px, y - py);
            near = Math.max(0, 1 - d / 18) * influence;
            v += Math.sin(d * 0.45 - t * 3.2) * near * 2.2;
          }

          const n = Math.min(1, Math.max(0, (v + 4) / 8));
          const idx = Math.min(CHARS.length - 1, Math.floor(n * (CHARS.length - 1)));
          const ch = CHARS[idx];
          if (!ch || ch === " ") continue;
          // Brighter glyphs at field peaks, dim mint in the troughs; glyphs
          // under the cursor lift further so the ripple reads clearly.
          const a = Math.min(0.95, 0.1 + n * n * 0.7 + near * 0.35);
          const g = 200 + Math.floor(n * 55);
          ctx.fillStyle = `rgba(${Math.floor(120 + n * 60)},${g},${Math.floor(200 + n * 40)},${a})`;
          ctx.fillText(ch, x * CELL, y * CELL);
        }
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
