"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/** Honour the OS "reduce motion" setting — every effect here falls back to static. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * One shared, rAF-throttled scroll/resize listener for every reveal on the page
 * — cheaper than N listeners, and it exists as a *backstop*, not the primary
 * trigger (see `useInView`).
 */
const watchers = new Set<() => void>();
let ticking = false;

function pump() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    for (const cb of watchers) cb();
  });
}

function watch(cb: () => void) {
  if (watchers.size === 0) {
    window.addEventListener("scroll", pump, { passive: true });
    window.addEventListener("resize", pump, { passive: true });
  }
  watchers.add(cb);
  return () => {
    watchers.delete(cb);
    if (watchers.size === 0) {
      window.removeEventListener("scroll", pump);
      window.removeEventListener("resize", pump);
    }
  };
}

/**
 * Fires once when the element first scrolls into view.
 *
 * Content that starts at `opacity: 0` must never be able to *stay* there, so
 * this deliberately does not trust IntersectionObserver alone. Observers get
 * deferred in background windows and are a common casualty of extensions and
 * prerendering — so a plain rect measurement runs on mount, on scroll/resize,
 * and when the tab becomes visible. Whichever signal arrives first wins; the
 * rest are then unsubscribed.
 */
export function useInView<T extends HTMLElement>(rootMargin = "0px 0px -12% 0px") {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    let done = false;
    const stop = () => {
      if (done) return;
      done = true;
      setInView(true);
      io.disconnect();
      unwatch();
      document.removeEventListener("visibilitychange", onVisible);
    };

    const check = () => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.95 && r.bottom > 0) stop();
    };

    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && stop(),
      { rootMargin, threshold: 0.08 },
    );
    io.observe(el);

    const unwatch = watch(check);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    check();

    return () => {
      io.disconnect();
      unwatch();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [rootMargin]);

  return { ref, inView };
}

/**
 * Fades + lifts its children in when they enter the viewport. `delay` staggers
 * siblings; keep it under ~400ms so nothing feels sluggish on a fast scroll.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li" | "span";
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <Tag
      ref={ref as never}
      className={`reveal ${inView ? "is-in" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/\\|<>_=+*#%$&@";

/**
 * Decodes text glyph-by-glyph from noise — the "terminal resolving a signal"
 * effect. Locks left-to-right so the final string is readable throughout.
 */
export function Scramble({
  text,
  className = "",
  speed = 34,
  startDelay = 0,
}: {
  text: string;
  className?: string;
  speed?: number;
  startDelay?: number;
}) {
  const reduced = usePrefersReducedMotion();
  const [out, setOut] = useState(text);

  useEffect(() => {
    if (reduced) {
      setOut(text);
      return;
    }
    let frame = 0;
    let raf = 0;
    let timer = 0;
    const chars = [...text];

    const tick = () => {
      // Two glyphs settle per frame; the rest churn.
      const settled = Math.floor(frame / 2);
      setOut(
        chars
          .map((c, i) => {
            if (i < settled || c === " ") return c;
            return GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? c;
          })
          .join(""),
      );
      frame += 1;
      if (settled <= chars.length) raf = window.setTimeout(tick, speed);
      else setOut(text);
    };

    timer = window.setTimeout(tick, startDelay);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(raf);
    };
  }, [text, speed, startDelay, reduced]);

  // aria-label keeps the real string available to screen readers mid-scramble.
  return (
    <span className={className} aria-label={text}>
      <span aria-hidden="true">{out}</span>
    </span>
  );
}

/** Counts up to `value` once visible. Purely cosmetic — the number is exact at rest. */
export function Counter({
  value,
  decimals = 0,
  duration = 900,
  className = "",
}: {
  value: number;
  decimals?: number;
  duration?: number;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const { ref, inView } = useInView<HTMLSpanElement>();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setShown(value);
      return;
    }
    let raf = 0;
    const from = shown;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // `shown` is read as a starting point only; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, inView, duration, reduced]);

  return (
    <span ref={ref} className={className}>
      {shown.toFixed(decimals)}
    </span>
  );
}

/** Card whose glow follows the pointer. Falls back to a plain card without one. */
export function SpotlightCard({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, []);

  return (
    <div ref={ref} onMouseMove={onMove} className={`spotlight ${className}`} style={style}>
      {children}
    </div>
  );
}

/**
 * Seamless infinite ticker. The track is rendered twice and translated -50%,
 * so the loop point is invisible. Hover pauses it for reading.
 */
export function Marquee({
  children,
  duration = 42,
  className = "",
}: {
  children: ReactNode;
  duration?: number;
  className?: string;
}) {
  return (
    <div className={`marquee-mask overflow-hidden ${className}`}>
      <div className="marquee-track" style={{ ["--marquee-duration" as string]: `${duration}s` }}>
        <div className="flex shrink-0 items-center gap-2 pr-2">{children}</div>
        <div className="flex shrink-0 items-center gap-2 pr-2" aria-hidden="true">
          {children}
        </div>
      </div>
    </div>
  );
}

/** `// SECTION` label with a light sweeping along the rule. */
export function SectionHeading({ label, right }: { label: string; right?: ReactNode }) {
  return (
    <Reveal className="mb-8 flex items-center gap-3">
      <span className="mono text-xs text-accent">// {label}</span>
      <div className="rule flex-1" />
      {right ? <span className="mono text-[10px] text-muted">{right}</span> : null}
    </Reveal>
  );
}
