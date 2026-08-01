/**
 * @0c/credits — pure pricing + earn-share math. No I/O, no native deps, so it
 * is safe to import in both the orchestrator (Node) and the web app (browser).
 *
 * Money model: 1 credit = $0.01. All balances are stored as integer credits in
 * the ledger; this module never touches the DB, it only computes numbers.
 */

export const CREDIT_USD = 0.01;

/**
 * $0C — the network's native token (design/params; not yet deployed on-chain).
 * Fixed 1,000,000,000 supply. Credits (1 = $0.01) remain the stable unit of
 * account; $0C is the ownership + settlement layer that credits can be bought
 * with and that protocol fees buy back and burn.
 */
export const TOKEN = {
  symbol: "0C",
  ticker: "$0C",
  name: "Open Communication",
  chain: "Solana",
  decimals: 6, // pump.fun tokens use 6 decimals
  totalSupply: 1_000_000_000,
  // NOTE: the mint address is deliberately NOT stored here — it must never be
  // rendered on the site. Server-side consumers (the keeper) read it from the
  // OC_MINT env var instead.
  status: "launching" as const,
  allocation: [
    { label: "Ecosystem & Community", pct: 40 },
    { label: "Worker Rewards (emissions)", pct: 25 },
    { label: "Team & Contributors (4y vest)", pct: 15 },
    { label: "Treasury / DAO", pct: 12 },
    { label: "Liquidity", pct: 5 },
    { label: "Public / Airdrop", pct: 3 },
  ],
} as const;

export function formatSupply(n = TOKEN.totalSupply): string {
  if (n >= 1e9) return `${n / 1e9}B`;
  if (n >= 1e6) return `${n / 1e6}M`;
  return n.toLocaleString();
}


/**
 * Per-model price in credits per 1K tokens. Prompt + completion are billed the
 * same in MVP; split later if needed. `echo` is effectively free so the
 * end-to-end pipeline is cheap to demo.
 */
export const MODEL_PRICES: Record<string, { per1kTokens: number }> = {
  echo: { per1kTokens: 1 },
  "llama3.2": { per1kTokens: 5 },
  "llama3.1": { per1kTokens: 8 },
  "qwen2.5": { per1kTokens: 6 },
  default: { per1kTokens: 10 },
};

/** Share of a job's charge that accrues to the worker that served it. */
export const WORKER_EARN_SHARE = 0.7;

/** Share of a job's charge routed to the staking rewards pool (from protocol margin). */
export const STAKE_FEE_RATE = 0.1;

/** Credits from one settled job that flow to stakers. */
export function stakingFee(charge: number): number {
  return Math.floor(charge * STAKE_FEE_RATE);
}

export function priceFor(model: string): number {
  return (MODEL_PRICES[model] ?? MODEL_PRICES.default!).per1kTokens;
}

/**
 * How many credits to RESERVE up front, before the job runs. We don't know the
 * completion length yet, so reserve against an assumed max so a user can never
 * overspend mid-stream. Refunded down to the real cost at settlement.
 */
export function reserveEstimate(model: string, promptTokens: number, maxTokens = 512): number {
  const totalTokens = promptTokens + maxTokens;
  return Math.max(1, Math.ceil((totalTokens / 1000) * priceFor(model)));
}

/** Final charge once the real token counts are known. */
export function settleCost(
  model: string,
  usage: { promptTokens: number; completionTokens: number },
): number {
  const totalTokens = usage.promptTokens + usage.completionTokens;
  return Math.max(1, Math.ceil((totalTokens / 1000) * priceFor(model)));
}

/** Credits earned by the serving worker for a settled job. */
export function workerEarn(charge: number): number {
  return Math.floor(charge * WORKER_EARN_SHARE);
}

/** Flat credit cost to generate one image. */
export const IMAGE_CREDITS = 20;
export function imageCost(): number {
  return IMAGE_CREDITS;
}

/** Flat credit cost for an agent run (multiple model turns + tool calls). */
export const AGENT_CREDITS = 15;
export function agentCost(): number {
  return AGENT_CREDITS;
}

/**
 * Formally-verified math via Harmonic's Aristotle. This is an EXTERNAL,
 * third-party model — the only path where a prompt leaves the 0_C network — so
 * it is surfaced under its own model id and priced separately.
 */
export const ARISTOTLE_MODEL = "aristotle-verified";
/**
 * A verified run is minutes of proof-agent time in a Lean workspace (the √2
 * proof took ~7 min), so it is priced well above a chat completion. Override
 * with ARISTOTLE_CREDITS on the orchestrator.
 */
export const ARISTOTLE_CREDITS = 100; // $1.00
/** Pre-filtered trivial arithmetic never reaches Aristotle — charge accordingly. */
export const ARISTOTLE_TRIVIAL_CREDITS = 1;
export function aristotleCost(): number {
  return ARISTOTLE_CREDITS;
}

/** Rough token estimate for text without a real tokenizer (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function creditsToUsd(credits: number): number {
  return credits * CREDIT_USD;
}

/** 100 credits ($1.00) = 1 USDC. */
export function creditsToUsdc(credits: number): number {
  return credits / 100;
}
