/** Verifies X bot logic: command parsing, token-gate tiers, linking, dedupe, quotas. */
import { createDb } from "@0c/db";
import { makeTokenGate } from "../src/tokengate.js";
import { LINK_PREFIX, formatProofReply, newLinkCode, parseCommand } from "../src/xbot.js";

let pass = true;
const check = (n: string, ok: boolean) => { console.log(`   ${ok ? "✓" : "✗"} ${n}`); if (!ok) pass = false; };

console.log("1) command parsing");
check("/prove with statement", parseCommand("@0C_bot /prove there are infinitely many primes").kind === "prove");
check("strips leading mention", (parseCommand("@0C_bot /prove x+0=x") as any).text === "x+0=x");
check("bare /prove -> help", parseCommand("@bot /prove").kind === "help");
check("plain chatter ignored", parseCommand("@bot gm frens").kind === "none");
check("link code detected", parseCommand(`@bot ${LINK_PREFIX}A1B2C3D4`).kind === "link");
check("link code uppercased", (parseCommand(`${LINK_PREFIX.toLowerCase()}a1b2c3d4`) as any).code === `${LINK_PREFIX}A1B2C3D4`);
check("generated code parses back", parseCommand(newLinkCode()).kind === "link");

console.log("2) token-gate tiers (1M limited / 10M unlimited)");
const gate = makeTokenGate({ token: "", rpcUrl: "", chain: "mainnet", tier1: 1_000_000, tier2: 10_000_000, tier1DailyLimit: 5 });
check("0 tokens -> none", gate.tierFor(0).tier === "none");
check("999,999 -> none (below tier1)", gate.tierFor(999_999).tier === "none");
check("1,000,000 -> limited", gate.tierFor(1_000_000).tier === "limited");
check("limited has 5/day cap", gate.tierFor(2_000_000).dailyLimit === 5);
check("10,000,000 -> unlimited", gate.tierFor(10_000_000).tier === "unlimited");
check("unlimited has no cap", gate.tierFor(50_000_000).dailyLimit === null);

console.log("3) linking is spoof-resistant");
const db = createDb(":memory:", { signupGrant: 0 });
db.ensureUser("alice");
const code = newLinkCode();
db.createXLinkCode(code, "alice", "WalletAlice1111");
check("unlinked handle resolves to null", db.xLinkForHandle("alice_x") === null);
const v = db.verifyXLinkCode(code, "alice_x");
check("code verifies for the tweeting handle", v.ok === true);
check("handle now resolves to the wallet", db.xLinkForHandle("alice_x")?.wallet === "WalletAlice1111");
const steal = db.verifyXLinkCode(code, "attacker_x");
check("another handle cannot reuse the code", steal.ok === false);
check("attacker still unlinked", db.xLinkForHandle("attacker_x") === null);
check("unknown code rejected", db.verifyXLinkCode("0C-LINK-DEADBEEF", "x").ok === false);
check("re-verify by same handle is idempotent", db.verifyXLinkCode(code, "alice_x").ok === true);

console.log("3b) handles are case-insensitive (X treats @O_C_ == @o_c_)");
const db2 = createDb(":memory:", { signupGrant: 0 });
db2.ensureUser("bob");
const code2 = newLinkCode();
db2.createXLinkCode(code2, "bob", "WalletBob1111");
db2.verifyXLinkCode(code2, "Marsel_X");        // stored with mixed case
check("lookup with different casing finds it", db2.xLinkForHandle("marsel_x")?.wallet === "WalletBob1111");
check("lookup with a leading @ finds it", db2.xLinkForHandle("@MARSEL_X")?.wallet === "WalletBob1111");
db2.logXRequest("t9", "MARSEL_X", "prove", "accepted");
check("quota counts across casings", db2.xRequestsToday("marsel_x") === 1);

console.log("4) dedupe + daily quota");
check("unseen tweet", db.xRequestSeen("t1") === false);
db.logXRequest("t1", "alice_x", "prove", "accepted");
check("seen after logging (no double-reply)", db.xRequestSeen("t1") === true);
check("counts toward today", db.xRequestsToday("alice_x") === 1);
db.logXRequest("t2", "alice_x", "prove", "rejected");
check("rejected does NOT count toward quota", db.xRequestsToday("alice_x") === 1);
db.logXRequest("t3", "alice_x", "prove", "replied");
check("replied counts", db.xRequestsToday("alice_x") === 2);
check("other handle unaffected", db.xRequestsToday("bob_x") === 0);

console.log("5) cursor + reply formatting");
check("cursor starts null", db.xCursor() === null);
db.setXCursor("999");
check("cursor persists", db.xCursor() === "999");
const long = formatProofReply("stmt", "x".repeat(500), true);
check("reply fits X 280-char limit", long.length <= 280);
check("verified marker present", long.startsWith("✓ formally verified"));
check("reply contains no URL (avoids $0.20 fee)", !/https?:\/\//.test(long));

console.log("\n" + (pass ? "OK — X bot logic verified." : "FAIL — see above."));
process.exit(pass ? 0 : 1);
