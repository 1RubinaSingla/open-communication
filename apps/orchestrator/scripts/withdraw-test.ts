/** Unit tests for withdrawal caps, atomic deduct, refund, and key loading. */
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { createDb } from "@0c/db";
import { loadKeypair } from "../src/payout.js";

let pass = true;
const check = (n: string, ok: boolean) => { console.log(`   ${ok ? "✓" : "✗"} ${n}`); if (!ok) pass = false; };
const throwsWith = (fn: () => unknown, needle: string) => {
  try { fn(); return false; } catch (e) { return (e as Error).message.toLowerCase().includes(needle.toLowerCase()); }
};

const caps = { min: 100, maxPerRequest: 5000, maxPerDay: 20000 };
const P = { amount: 0.06, currency: "SOL" }; // payout amount comes from the caller (live price)
const db = createDb(":memory:", { signupGrant: 0 });
db.ensureUser("alice");
db.creditDeposit("alice", 10000, "sig-alice-deposit"); // real money in, so it is cashable

console.log("1) caps + atomic deduct");
const w = db.requestWithdrawal("alice", 500, "RecipientAddr111", caps, P);
check("deducts credits (10000→9500)", db.balanceOf("alice") === 9500);
check("stores payout amount + SOL currency", w.amount === 0.06 && w.currency === "SOL");
check("status = requested", w.status === "requested");
check("rejects below minimum", throwsWith(() => db.requestWithdrawal("alice", 50, "x", caps, P), "minimum"));
check("rejects above per-request cap", throwsWith(() => db.requestWithdrawal("alice", 6000, "x", caps, P), "maximum per"));
check("rejects zero payout amount (price feed down)", throwsWith(() => db.requestWithdrawal("alice", 200, "x", caps, { amount: 0, currency: "SOL" }), "payout amount"));
const dbPoor = createDb(":memory:", { signupGrant: 300 });
dbPoor.ensureUser("poor");
check("rejects above balance", throwsWith(() => dbPoor.requestWithdrawal("poor", 400, "x", caps, P), "insufficient"));

console.log("1b) THE EXPLOIT: free grant credits are not cashable");
const dbG = createDb(":memory:", { signupGrant: 500 });
dbG.ensureUser("freeloader");   // 500 credits, all promotional
check("has a spendable balance", dbG.balanceOf("freeloader") === 500);
check("but nothing is withdrawable", dbG.withdrawableOf("freeloader") === 0);
check("withdrawal is refused", throwsWith(() => dbG.requestWithdrawal("freeloader", 500, "x", caps, P), "withdrawable"));

// a real depositor CAN cash out what they put in
dbG.creditDeposit("depositor", 1000, "sig-real-deposit");
check("deposit is withdrawable", dbG.withdrawableOf("depositor") === 1000);
dbG.requestWithdrawal("depositor", 500, "addr", caps, P);
check("withdrawing reduces the cashable amount", dbG.withdrawableOf("depositor") === 500);
// the case that matters: plenty of BALANCE, but part of it is promotional
const dbMix = createDb(":memory:", { signupGrant: 500 });
dbMix.ensureUser("mixed");                       // 500 free
dbMix.creditDeposit("mixed", 1000, "sig-mixed"); // + 1000 real
check("mixed balance = 1500", dbMix.balanceOf("mixed") === 1500);
check("only the deposited 1000 is withdrawable", dbMix.withdrawableOf("mixed") === 1000);
check(
  "withdrawing 1200 is refused despite a 1500 balance",
  throwsWith(() => dbMix.requestWithdrawal("mixed", 1200, "addr", caps, P), "withdrawable"),
);
check("withdrawing exactly 1000 is allowed", (() => {
  try { dbMix.requestWithdrawal("mixed", 1000, "addr", caps, P); return true; } catch { return false; }
})());

// worker earnings count as genuinely earned
const dbE = createDb(":memory:", { signupGrant: 500 });
dbE.ensureUser("payer2");
dbE.reserve("payer2", "j1", 500, "llama3.2");
dbE.settle("payer2", "j1", 500, "llama3.2", { promptTokens: 0, completionTokens: 20000 }, "worker-x");
check("worker earnings are withdrawable", dbE.withdrawableOf("worker-x") > 0);

console.log("2) daily cap");
const db2 = createDb(":memory:", { signupGrant: 0 });
db2.ensureUser("bob");
db2.creditDeposit("bob", 30000, "sig-bob-deposit");
const caps2 = { min: 100, maxPerRequest: 20000, maxPerDay: 20000 };
db2.requestWithdrawal("bob", 15000, "x", caps2, P);
check("first 15000 ok", db2.balanceOf("bob") === 15000);
check("second 6000 hits daily cap", throwsWith(() => db2.requestWithdrawal("bob", 6000, "x", caps2, P), "daily"));

console.log("3) refund vs review");
const w3 = db.requestWithdrawal("alice", 300, "x", caps, P);
const bal1 = db.balanceOf("alice");
db.markWithdrawalFailed(w3.id, "preflight failed", true);
check("refund on not-submitted failure restores credits", db.balanceOf("alice") === bal1 + 300);
check("refunded withdrawal marked failed", db.getWithdrawal(w3.id)!.status === "failed");
const w4 = db.requestWithdrawal("alice", 300, "x", caps, P);
const bal2 = db.balanceOf("alice");
db.markWithdrawalFailed(w4.id, "unconfirmed", false);
check("submitted failure does NOT refund (no double-pay)", db.balanceOf("alice") === bal2);
check("unconfirmed withdrawal marked review", db.getWithdrawal(w4.id)!.status === "review");

console.log("4) key loading");
{
  // Generate a keypair rather than reading an operator's key file, so this runs
  // anywhere (including CI) with no secrets present.
  const kp = Keypair.generate();
  const b64 = Buffer.from(kp.secretKey).toString("base64");
  check("base64 key -> correct pubkey", loadKeypair(b64).publicKey.toBase58() === kp.publicKey.toBase58());
  const json = JSON.stringify(Array.from(kp.secretKey));
  check("JSON-array key -> correct pubkey", loadKeypair(json).publicKey.toBase58() === kp.publicKey.toBase58());
  check("base58 key -> correct pubkey", loadKeypair(bs58.encode(kp.secretKey)).publicKey.toBase58() === kp.publicKey.toBase58());
  check("garbage key is rejected", (() => { try { loadKeypair("nonsense"); return false; } catch { return true; } })());
}

console.log("\n" + (pass ? "OK — SOL withdrawal logic verified." : "FAIL — see above."));
process.exit(pass ? 0 : 1);
