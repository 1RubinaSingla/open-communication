/**
 * Public X (Twitter) bot for 0_C.
 *
 * Mechanic: reply to the bot with `/prove <statement>` and it returns a
 * formally-verified Lean proof via Aristotle — a capability almost nothing else
 * can do publicly. Access is gated on $0C holdings.
 *
 * Cost discipline (X moved to pay-per-use in Feb 2026):
 *   read  ~$0.001–0.005   plain reply  $0.015   reply WITH A LINK  $0.20
 * So replies are always plain text — never link back to the site. A 13x fee for
 * a URL would dominate the bill at any real volume.
 *
 * Anti-spoofing: an X handle only counts as a holder once it has been linked to
 * a wallet (wallet connected on the site + one-time code tweeted from the
 * account). Without that, anyone could paste a whale's address.
 */
import { randomBytes } from "node:crypto";

export const LINK_PREFIX = "0C-LINK-";

/** A one-time code the user tweets to prove they control the X account. */
export function newLinkCode(): string {
  return LINK_PREFIX + randomBytes(4).toString("hex").toUpperCase();
}

export type Command =
  | { kind: "prove"; text: string }
  | { kind: "link"; code: string }
  | { kind: "help" }
  | { kind: "none" };

/** Parse a mention's text into a command. Tolerant of the leading @mention. */
export function parseCommand(raw: string): Command {
  const text = String(raw ?? "")
    .replace(/^(?:\s*@[A-Za-z0-9_]+\s*)+/, "") // strip leading mentions
    .trim();

  const link = text.match(new RegExp(`${LINK_PREFIX}[A-F0-9]{8}`, "i"));
  if (link) return { kind: "link", code: link[0].toUpperCase() };

  const prove = text.match(/^\/prove\b\s*([\s\S]+)$/i);
  if (prove && prove[1]?.trim()) return { kind: "prove", text: prove[1].trim() };

  if (/^\/help\b/i.test(text) || /^\/prove\s*$/i.test(text)) return { kind: "help" };
  return { kind: "none" };
}

export const HELP_TEXT =
  "Reply with /prove <statement> for a formally-verified Lean proof.\n" +
  "Access needs linked $0C holdings — connect your wallet on Open Communication, then tweet your 0C-LINK code.";

/** X reply cap is 280 chars; keep proofs readable and never append links. */
export function formatProofReply(statement: string, answer: string, verified: boolean): string {
  const head = verified ? "✓ formally verified" : "⚠ completed with caveats";
  const body = answer.replace(/\s+/g, " ").trim();
  const budget = 280 - head.length - 3;
  return `${head}\n\n${body.length > budget ? body.slice(0, budget - 1) + "…" : body}`;
}

export interface XBotConfig {
  enabled: boolean;
  dryRun: boolean;
  handle: string;
  bearerToken: string;
  pollMs: number;
  globalDailyCap: number;
}

export function xbotConfigFromEnv(): XBotConfig {
  return {
    enabled: process.env.X_BOT_ENABLED === "true",
    dryRun: process.env.X_BOT_DRY_RUN !== "false",
    handle: (process.env.X_BOT_HANDLE ?? "O_C_").replace(/^@/, ""),
    bearerToken: process.env.X_BEARER_TOKEN ?? "",
    pollMs: Number(process.env.X_BOT_POLL_MS ?? 120_000),
    globalDailyCap: Number(process.env.X_BOT_DAILY_CAP ?? 50),
  };
}
