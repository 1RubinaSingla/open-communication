/** Verifies the optional wallet link: real signatures pass, forgeries don't. */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ORCH = process.env.ORCH ?? "http://localhost:4100";

/** These are test fixtures, not production parsing — `any` keeps them readable. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (r: Response): Promise<any> => r.json();

let pass = true;
const check = (n: string, ok: boolean) => { console.log(`   ${ok ? "✓" : "✗"} ${n}`); if (!ok) pass = false; };

async function token(userId: string) {
  const r = await fetch(`${ORCH}/auth/dev`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }),
  }).then(json);
  return r.token as string;
}
const post = (t: string, body: unknown) =>
  fetch(`${ORCH}/me/wallet`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: JSON.stringify(body),
  });

const alice = await token("wallet-alice");
const account = privateKeyToAccount(generatePrivateKey());
const wallet = account.address;
// EIP-191 personal_sign, exactly what MetaMask produces for a string message.
const sign = (message: string) => account.signMessage({ message });

console.log("1) a genuine signature links the wallet");
const ch = await fetch(`${ORCH}/me/wallet/challenge`, { headers: { Authorization: `Bearer ${alice}` } }).then(json);
check("challenge names the account", ch.message.includes("wallet-alice"));
check("challenge says it authorises nothing", ch.message.toLowerCase().includes("authorises no transaction"));
const good = await post(alice, { wallet, signature: await sign(ch.message), issuedAt: ch.issuedAt });
check("accepted", good.status === 200);
const me = await fetch(`${ORCH}/me`, { headers: { Authorization: `Bearer ${alice}` } }).then(json);
check("wallet stored on the account", me.wallet === wallet.toLowerCase());

console.log("2) forgery is rejected");
const other = privateKeyToAccount(generatePrivateKey());
const ch2 = await fetch(`${ORCH}/me/wallet/challenge`, { headers: { Authorization: `Bearer ${alice}` } }).then(json);
// signing correctly but claiming someone else's address
const claim = await post(alice, { wallet: other.address, signature: await sign(ch2.message), issuedAt: ch2.issuedAt });
check("cannot claim a wallet you don't control", claim.status === 400);
// a signature over a different message
const wrongMsg = await post(alice, { wallet, signature: await sign("some other message"), issuedAt: ch2.issuedAt });
check("signature over a different message rejected", wrongMsg.status === 400);
// another user's challenge
const bob = await token("wallet-bob");
const chBob = await fetch(`${ORCH}/me/wallet/challenge`, { headers: { Authorization: `Bearer ${bob}` } }).then(json);
const crossUser = await post(alice, { wallet, signature: await sign(chBob.message), issuedAt: chBob.issuedAt });
check("another account's challenge rejected", crossUser.status === 400);
// expired
const stale = await post(alice, { wallet, signature: await sign(ch2.message), issuedAt: Date.now() - 10 * 60_000 });
check("expired challenge rejected", stale.status === 400);
check("invalid address rejected", (await post(alice, { wallet: "nope", signature: "0x00", issuedAt: Date.now() })).status === 400);
check("unauthenticated rejected", (await fetch(`${ORCH}/me/wallet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status === 401);

console.log("3) disconnect");
await fetch(`${ORCH}/me/wallet`, { method: "DELETE", headers: { Authorization: `Bearer ${alice}` } });
const after = await fetch(`${ORCH}/me`, { headers: { Authorization: `Bearer ${alice}` } }).then(json);
check("wallet cleared", !after.wallet);

console.log("\n" + (pass ? "OK — wallet linking verified." : "FAIL — see above."));
process.exit(pass ? 0 : 1);
