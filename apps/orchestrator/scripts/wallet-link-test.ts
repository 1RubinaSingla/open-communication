/** Verifies the optional wallet link: real signatures pass, forgeries don't. */
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519";

const ORCH = process.env.ORCH ?? "http://localhost:4100";

let pass = true;
const check = (n: string, ok: boolean) => { console.log(`   ${ok ? "✓" : "✗"} ${n}`); if (!ok) pass = false; };

async function token(userId: string) {
  const r = await fetch(`${ORCH}/auth/dev`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }),
  }).then((x) => x.json());
  return r.token as string;
}
const post = (t: string, body: unknown) =>
  fetch(`${ORCH}/me/wallet`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: JSON.stringify(body),
  });

const alice = await token("wallet-alice");
const kp = Keypair.generate();
const wallet = kp.publicKey.toBase58();
const sign = (msg: string) => bs58.encode(ed25519.sign(new TextEncoder().encode(msg), kp.secretKey.slice(0, 32)));

console.log("1) a genuine signature links the wallet");
const ch = await fetch(`${ORCH}/me/wallet/challenge`, { headers: { Authorization: `Bearer ${alice}` } }).then((r) => r.json());
check("challenge names the account", ch.message.includes("wallet-alice"));
check("challenge says it authorises nothing", ch.message.toLowerCase().includes("authorises no transaction"));
const good = await post(alice, { wallet, signature: sign(ch.message), issuedAt: ch.issuedAt });
check("accepted", good.status === 200);
const me = await fetch(`${ORCH}/me`, { headers: { Authorization: `Bearer ${alice}` } }).then((r) => r.json());
check("wallet stored on the account", me.wallet === wallet);

console.log("2) forgery is rejected");
const other = Keypair.generate();
const ch2 = await fetch(`${ORCH}/me/wallet/challenge`, { headers: { Authorization: `Bearer ${alice}` } }).then((r) => r.json());
// signing correctly but claiming someone else's address
const claim = await post(alice, { wallet: other.publicKey.toBase58(), signature: sign(ch2.message), issuedAt: ch2.issuedAt });
check("cannot claim a wallet you don't control", claim.status === 400);
// a signature over a different message
const wrongMsg = await post(alice, { wallet, signature: sign("some other message"), issuedAt: ch2.issuedAt });
check("signature over a different message rejected", wrongMsg.status === 400);
// another user's challenge
const bob = await token("wallet-bob");
const chBob = await fetch(`${ORCH}/me/wallet/challenge`, { headers: { Authorization: `Bearer ${bob}` } }).then((r) => r.json());
const crossUser = await post(alice, { wallet, signature: sign(chBob.message), issuedAt: chBob.issuedAt });
check("another account's challenge rejected", crossUser.status === 400);
// expired
const stale = await post(alice, { wallet, signature: sign(ch2.message), issuedAt: Date.now() - 10 * 60_000 });
check("expired challenge rejected", stale.status === 400);
check("invalid address rejected", (await post(alice, { wallet: "nope", signature: "x", issuedAt: Date.now() })).status === 400);
check("unauthenticated rejected", (await fetch(`${ORCH}/me/wallet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status === 401);

console.log("3) disconnect");
await fetch(`${ORCH}/me/wallet`, { method: "DELETE", headers: { Authorization: `Bearer ${alice}` } });
const after = await fetch(`${ORCH}/me`, { headers: { Authorization: `Bearer ${alice}` } }).then((r) => r.json());
check("wallet cleared", !after.wallet);

console.log("\n" + (pass ? "OK — wallet linking verified." : "FAIL — see above."));
process.exit(pass ? 0 : 1);
