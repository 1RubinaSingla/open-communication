/**
 * X bot runner — poll mentions, answer `/prove` with a verified Lean proof.
 *
 * Run on a schedule (or as a long-lived process). Safe by default: does nothing
 * unless X_BOT_ENABLED=true, and never posts unless X_BOT_DRY_RUN=false.
 *
 * Cost note: replies are plain text on purpose. X charges $0.015 for a plain
 * post but $0.20 when it contains a URL, so the bot never links back.
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createDb } from "@0c/db";
import { aristotleConfigFromEnv, makeAristotle } from "../src/aristotle.js";
import { gateConfigFromEnv, makeTokenGate } from "../src/tokengate.js";
import { HELP_TEXT, formatProofReply, parseCommand, xbotConfigFromEnv } from "../src/xbot.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

const cfg = xbotConfigFromEnv();
const gate = makeTokenGate(gateConfigFromEnv());
const aristotle = makeAristotle(aristotleConfigFromEnv());
const db = createDb(resolve(__dirname, "../../../", process.env.DB_PATH ?? "./data/0c.sqlite"));

const X_API = "https://api.x.com/2";
const xHeaders = { Authorization: `Bearer ${cfg.bearerToken}`, "Content-Type": "application/json" };

async function fetchMentions(userId: string, sinceId: string | null) {
  const params = new URLSearchParams({ max_results: "25", "tweet.fields": "author_id,text,created_at" });
  params.set("expansions", "author_id");
  params.set("user.fields", "username");
  if (sinceId) params.set("since_id", sinceId);
  const res = await fetch(`${X_API}/users/${userId}/mentions?${params}`, { headers: xHeaders });
  if (!res.ok) throw new Error(`mentions ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<any>;
}

async function reply(tweetId: string, text: string) {
  if (cfg.dryRun) {
    console.log(`[xbot] DRY RUN — would reply to ${tweetId}:\n${text}\n`);
    return true;
  }
  const res = await fetch(`${X_API}/tweets`, {
    method: "POST",
    headers: xHeaders,
    body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: tweetId } }),
  });
  if (!res.ok) {
    console.error(`[xbot] reply failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return false;
  }
  return true;
}

async function main() {
  if (!cfg.enabled) return console.log("[xbot] disabled (set X_BOT_ENABLED=true).");
  if (!cfg.bearerToken) return console.log("[xbot] no X_BEARER_TOKEN — cannot read mentions.");
  if (!cfg.handle) return console.log("[xbot] no X_BOT_HANDLE set.");

  // resolve our own numeric id (owned reads are the cheap tier)
  const me = (await fetch(`${X_API}/users/by/username/${cfg.handle}`, { headers: xHeaders }).then((r) =>
    r.json(),
  )) as { data?: { id?: string } };
  const myId = me?.data?.id;
  if (!myId) return console.error("[xbot] could not resolve bot user id:", JSON.stringify(me).slice(0, 200));

  const cursor = db.xCursor();
  const page = await fetchMentions(myId, cursor);
  const tweets: any[] = page?.data ?? [];
  const users = new Map<string, string>(
    (page?.includes?.users ?? []).map((u: any) => [u.id, u.username]),
  );
  if (!tweets.length) return console.log("[xbot] no new mentions.");
  console.log(`[xbot] ${tweets.length} new mention(s)${cfg.dryRun ? " [DRY RUN]" : ""}`);

  let handled = 0;
  // oldest first so the cursor advances monotonically
  for (const t of [...tweets].reverse()) {
    if (handled >= cfg.globalDailyCap) {
      console.log("[xbot] global daily cap reached — stopping.");
      break;
    }
    const tweetId = String(t.id);
    const handle = users.get(String(t.author_id)) ?? "";
    db.setXCursor(tweetId); // advance even when skipped, so we never loop
    if (db.xRequestSeen(tweetId)) continue;

    const cmd = parseCommand(String(t.text ?? ""));
    if (cmd.kind === "none") continue;

    // --- link: bind this X handle to the wallet that generated the code ---
    if (cmd.kind === "link") {
      const res = db.verifyXLinkCode(cmd.code, handle);
      db.logXRequest(tweetId, handle, "link", res.ok ? "replied" : "rejected", res.ok ? undefined : res.error);
      await reply(tweetId, res.ok ? `Linked @${handle} to your wallet. You can now use /prove.` : `Link failed: ${res.error}`);
      handled++;
      continue;
    }

    if (cmd.kind === "help") {
      db.logXRequest(tweetId, handle, "help", "replied");
      await reply(tweetId, HELP_TEXT);
      handled++;
      continue;
    }

    // --- prove: gated on linked $0C holdings ---
    const link = db.xLinkForHandle(handle);
    if (!link) {
      db.logXRequest(tweetId, handle, "prove", "rejected", "not linked");
      await reply(tweetId, `Not linked yet. ${HELP_TEXT}`);
      handled++;
      continue;
    }
    const g = await gate.check(link.wallet);
    if (g.tier === "none") {
      db.logXRequest(tweetId, handle, "prove", "rejected", `balance ${g.balance}`);
      await reply(tweetId, `Needs ${gate.cfg.tier1.toLocaleString()}+ $0C to use /prove (you hold ${Math.floor(g.balance).toLocaleString()}).`);
      handled++;
      continue;
    }
    if (g.dailyLimit !== null && db.xRequestsToday(handle) >= g.dailyLimit) {
      db.logXRequest(tweetId, handle, "prove", "rejected", "daily limit");
      await reply(tweetId, `Daily limit reached (${g.dailyLimit}/day). Hold ${gate.cfg.tier2.toLocaleString()}+ $0C for unlimited.`);
      handled++;
      continue;
    }

    db.logXRequest(tweetId, handle, "prove", "accepted");
    console.log(`[xbot] proving for @${handle}: ${cmd.text.slice(0, 80)}`);
    const r = await aristotle.solve(cmd.text, (p) => console.log(`   ${p}`));
    if (!r.ok || !r.text) {
      db.updateXRequest(tweetId, "failed", r.error);
      await reply(tweetId, `Could not verify that one${r.error ? ` (${r.error.slice(0, 80)})` : ""}.`);
    } else {
      db.updateXRequest(tweetId, "replied");
      await reply(tweetId, formatProofReply(cmd.text, r.text, !!r.verified));
    }
    handled++;
  }
  console.log(`[xbot] handled ${handled}`);
}

main().catch((e) => {
  console.error("[xbot]", e);
  process.exit(1);
});
