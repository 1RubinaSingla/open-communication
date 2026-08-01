/**
 * Agent tools — executed centrally on the orchestrator (never on contributor
 * machines), so behavior is consistent and safe. Definitions are OpenAI/Ollama
 * function-calling format.
 */
import { aristotleConfigFromEnv, makeAristotle } from "./aristotle.js";

const aristotle = makeAristotle(aristotleConfigFromEnv());

/** True when the verified-math tool is available (ARISTOTLE_API_KEY set). */
export const verifiedMathEnabled = () => aristotle.enabled;

const VERIFIED_MATH_DEF = {
  type: "function",
  function: {
    name: "verified_math",
    description:
      "Solve a hard math problem or proof with FORMAL VERIFICATION (Harmonic Aristotle). Use for non-trivial mathematics, proofs, or when a guaranteed-correct answer matters. Note: this sends the problem to an external service. Use `calculator` for plain arithmetic.",
    parameters: {
      type: "object",
      properties: { problem: { type: "string", description: "the math problem or proof, in plain language or LaTeX" } },
      required: ["problem"],
    },
  },
} as const;

export const TOOL_DEFS_BASE = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for current, factual information. Use for anything you may not know.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "the search query" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculator",
      description: "Evaluate an arithmetic expression, e.g. (12*7)+3.5.",
      parameters: {
        type: "object",
        properties: { expression: { type: "string", description: "arithmetic expression" } },
        required: ["expression"],
      },
    },
  },
] as const;

/** Tools offered to the agent. verified_math is included only when configured. */
export const TOOL_DEFS: readonly unknown[] = aristotle.enabled
  ? [...TOOL_DEFS_BASE, VERIFIED_MATH_DEF]
  : TOOL_DEFS_BASE;

/** Evaluate a strictly-arithmetic expression, or null if it isn't one. */
function safeArithmetic(expr: string): number | null {
  const e = expr.trim();
  if (!e || !/^[-+*/()%.\d\s]+$/.test(e)) return null;
  if (!/\d/.test(e)) return null;
  try {
    // whitelisted to arithmetic only → no identifiers can be referenced
    const val = Function(`"use strict";return (${e});`)();
    return typeof val === "number" && Number.isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

function calculator(expression: string): string {
  const val = safeArithmetic(String(expression));
  if (val === null) return "Error: only arithmetic (+ - * / % . () and digits) is allowed.";
  return String(val);
}

/**
 * Cheap pre-filter for the verified-math path. Aristotle is a proof agent — a
 * single run takes minutes and spins up a Lean workspace — so plain arithmetic
 * should never reach it. Returns an instant answer for questions like
 * "what is 128 * 977?", or null to let Aristotle handle the real work.
 */
export function trivialMath(problem: string): string | null {
  const stripped = String(problem)
    .toLowerCase()
    .replace(/\b(what|whats|what's|is|the|value|of|calculate|compute|evaluate|solve|result|answer|please|equals?)\b/g, " ")
    .replace(/[?=]/g, " ")
    .trim();
  // require an actual operator — a bare number isn't a math question
  if (!/[-+*/%]/.test(stripped)) return null;
  const val = safeArithmetic(stripped);
  return val === null ? null : String(val);
}

const strip = (s: string) => (s ?? "").replace(/<[^>]+>/g, "").trim();
const T = () => AbortSignal.timeout(6000);

/** Which real search provider is active (based on env keys). */
export function searchProvider(): string {
  if (process.env.TAVILY_API_KEY) return "tavily";
  if (process.env.BRAVE_API_KEY) return "brave";
  if (process.env.SERPER_API_KEY) return "serper";
  return "keyless";
}

async function tavily(query: string): Promise<string> {
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: 4, include_answer: true }),
    signal: T(),
  });
  const j = (await r.json()) as { answer?: string; results?: Array<{ title: string; content: string; url: string }> };
  const parts: string[] = [];
  if (j.answer) parts.push(j.answer);
  for (const x of (j.results ?? []).slice(0, 4)) parts.push(`${x.title}: ${strip(x.content).slice(0, 180)} (${x.url})`);
  return parts.join("\n") || "No results.";
}

async function brave(query: string): Promise<string> {
  const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=4`, {
    headers: { "X-Subscription-Token": process.env.BRAVE_API_KEY!, Accept: "application/json" },
    signal: T(),
  });
  const j = (await r.json()) as { web?: { results?: Array<{ title: string; description: string; url: string }> } };
  const res = j.web?.results ?? [];
  return res.slice(0, 4).map((x) => `${x.title}: ${strip(x.description).slice(0, 180)} (${x.url})`).join("\n") || "No results.";
}

async function serper(query: string): Promise<string> {
  const r = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": process.env.SERPER_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num: 4 }),
    signal: T(),
  });
  const j = (await r.json()) as { answerBox?: { answer?: string; snippet?: string }; organic?: Array<{ title: string; snippet: string; link: string }> };
  const parts: string[] = [];
  if (j.answerBox?.answer) parts.push(j.answerBox.answer);
  else if (j.answerBox?.snippet) parts.push(j.answerBox.snippet);
  for (const o of (j.organic ?? []).slice(0, 4)) parts.push(`${o.title}: ${strip(o.snippet).slice(0, 180)} (${o.link})`);
  return parts.join("\n") || "No results.";
}

/** Keyless fallback: real Wikipedia content + DuckDuckGo instant answers. */
async function keyless(query: string): Promise<string> {
  const out: string[] = [];
  try {
    const r = await fetch(`https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=3`, {
      headers: { "User-Agent": "0C-agent/0.1 (open-communication)" },
      signal: T(),
    });
    const j = (await r.json()) as { pages?: Array<{ title: string; description?: string; excerpt?: string }> };
    for (const p of (j.pages ?? []).slice(0, 3)) {
      const desc = p.description || strip(p.excerpt ?? "");
      if (desc) out.push(`${p.title}: ${desc.slice(0, 180)}`);
    }
  } catch {
    /* ignore */
  }
  if (out.length === 0) {
    try {
      const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, { signal: T() });
      const j = (await r.json()) as { AbstractText?: string; Answer?: string };
      if (j.Answer) out.push(j.Answer);
      else if (j.AbstractText) out.push(j.AbstractText);
    } catch {
      /* ignore */
    }
  }
  return out.length ? out.join("\n") : "No results found.";
}

async function webSearch(query: string): Promise<string> {
  try {
    if (process.env.TAVILY_API_KEY) return await tavily(query);
    if (process.env.BRAVE_API_KEY) return await brave(query);
    if (process.env.SERPER_API_KEY) return await serper(query);
    return await keyless(query);
  } catch {
    return "Search failed.";
  }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  onProgress?: (s: string) => void,
): Promise<string> {
  if (name === "calculator") return calculator(String(args.expression ?? ""));
  if (name === "web_search") return webSearch(String(args.query ?? ""));
  if (name === "verified_math") {
    const problem = String(args.problem ?? "");
    // Don't spend minutes of proof-agent time on plain arithmetic.
    const quick = trivialMath(problem);
    if (quick !== null) {
      onProgress?.("trivial arithmetic — answered locally, skipped Aristotle");
      return `${quick}\n\n(computed locally; too simple to need formal verification)`;
    }
    const r = await aristotle.solve(problem, onProgress);
    if (!r.ok) return `Verified math unavailable: ${r.error}`;
    return `${r.text}${r.verified ? "\n\n(formally verified by Aristotle)" : ""}`;
  }
  return `Unknown tool: ${name}`;
}

/** Short human-readable label of a tool call, streamed to the UI. */
export function toolLabel(name: string, args: Record<string, unknown>): string {
  if (name === "web_search") return `web_search("${String(args.query ?? "").slice(0, 60)}")`;
  if (name === "calculator") return `calculator(${String(args.expression ?? "").slice(0, 60)})`;
  // Flag the one tool that transmits the prompt off-network.
  if (name === "verified_math")
    return `verified_math(${String(args.problem ?? "").slice(0, 60)}) ⚠ leaves network → Harmonic`;
  return `${name}(…)`;
}

export { aristotle };
