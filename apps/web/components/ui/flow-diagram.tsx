"use client";

/**
 * The whole network on one screen: a single orchestrator speaking two protocols,
 * plus the one documented path that leaves it. Packets animate along each edge
 * (CSS `flow-line`), so the diagram reads as live rather than decorative.
 */

interface Node {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub: string[];
  tone: "fg" | "accent" | "warn";
}

const NODES: Node[] = [
  { x: 12, y: 138, w: 158, h: 84, title: "YOU", sub: ["browser · API", "keys stay local"], tone: "fg" },
  {
    x: 316,
    y: 108,
    w: 256,
    h: 144,
    title: "ORCHESTRATOR",
    sub: [
      "socket.io · fastify",
      "routing · credit ledger",
      "blind relay (ciphertext)",
      "ed25519 attestation",
    ],
    tone: "accent",
  },
  { x: 718, y: 40, w: 190, h: 80, title: "GPU WORKERS", sub: ["ollama · webgpu", "earn 70%"], tone: "fg" },
  { x: 718, y: 148, w: 190, h: 80, title: "YOUR PEER", sub: ["x25519 sealed box", "decrypts on-device"], tone: "fg" },
  {
    x: 718,
    y: 256,
    w: 190,
    h: 80,
    title: "ARISTOTLE",
    sub: ["harmonic · lean 4", "⚠ leaves network"],
    tone: "warn",
  },
];

const EDGES: { d: string; tone: "accent" | "warn" }[] = [
  { d: "M170 180 H316", tone: "accent" },
  { d: "M572 150 C 650 150, 650 80, 718 80", tone: "accent" },
  { d: "M572 180 H718", tone: "accent" },
  { d: "M572 212 C 650 212, 650 296, 718 296", tone: "warn" },
];

/** Drawn after the nodes so a box can never clip a label. */
const EDGE_LABELS: { x: number; y: number; text: string; warn?: boolean }[] = [
  { x: 645, y: 106, text: "job.submit → tokens" },
  { x: 645, y: 172, text: "ciphertext only" },
  { x: 645, y: 268, text: "verified_math", warn: true },
];

const STROKE: Record<string, string> = {
  fg: "var(--border-strong)",
  accent: "var(--accent)",
  warn: "var(--warn)",
};

export function FlowDiagram() {
  return (
    <svg
      viewBox="0 0 920 360"
      className="h-auto w-full"
      role="img"
      aria-label="You connect to the orchestrator, which routes inference to GPU workers, blind-relays encrypted messages to your peer, and forwards only verified-maths problems to Harmonic Aristotle."
    >
      {EDGES.map((e) => (
        <g key={e.d}>
          <path d={e.d} fill="none" stroke="var(--border)" strokeWidth={1} />
          <path
            className="flow-line"
            d={e.d}
            fill="none"
            stroke={STROKE[e.tone]}
            strokeWidth={1.5}
            opacity={0.85}
          />
        </g>
      ))}

      {NODES.map((n) => (
        <g key={n.title}>
          <rect
            x={n.x}
            y={n.y}
            width={n.w}
            height={n.h}
            rx={3}
            fill="rgba(8,9,11,0.9)"
            stroke={STROKE[n.tone]}
            strokeWidth={n.tone === "accent" ? 1.4 : 1}
          />
          <text
            className="mono"
            x={n.x + 14}
            y={n.y + 26}
            fontSize={12}
            fontWeight={600}
            letterSpacing="0.1em"
            fill={n.tone === "warn" ? "var(--warn)" : "var(--fg)"}
          >
            {n.title}
          </text>
          {n.sub.map((s, i) => (
            <text
              key={s}
              className="mono"
              x={n.x + 14}
              y={n.y + 46 + i * 15}
              fontSize={9.5}
              fill="var(--muted)"
            >
              {s}
            </text>
          ))}
        </g>
      ))}

      {/* edge labels last, on a scrim, so they stay readable over any line */}
      <g className="mono" fontSize={9} letterSpacing="0.06em">
        {EDGE_LABELS.map((l) => (
          <text
            key={l.text}
            x={l.x}
            y={l.y}
            textAnchor="middle"
            fill={l.warn ? "var(--warn)" : "var(--muted)"}
            stroke="rgba(8,9,11,0.95)"
            strokeWidth={3.5}
            paintOrder="stroke"
          >
            {l.text}
          </text>
        ))}
      </g>
    </svg>
  );
}
