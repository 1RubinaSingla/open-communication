/**
 * End-to-end devnet test for the Solana deposit on-ramp — no browser wallet
 * needed. Airdrops to a fresh keypair, pays the treasury with a memo, then
 * drives the orchestrator's /credits/deposit endpoint and checks crediting,
 * idempotency, and memo-binding security.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const PAYER_FILE = "/tmp/0c-payer.json";

/** Reuse one payer across runs so we don't hit the faucet repeatedly. */
function loadPayer(): Keypair {
  if (existsSync(PAYER_FILE)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(PAYER_FILE, "utf8"))));
  }
  const kp = Keypair.generate();
  writeFileSync(PAYER_FILE, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

/** Gentle single-shot airdrop via raw RPC (avoids web3's 429 retry storm). */
async function rawAirdrop(conn: Connection, pk: PublicKey): Promise<boolean> {
  if ((await conn.getBalance(pk)) >= 0.06 * 1e9) return true; // already funded
  const r = await fetch(clusterApiUrl("devnet"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "requestAirdrop", params: [pk.toBase58(), 0.2 * 1e9] }),
  }).then((x) => x.json());
  if (!r.result) {
    console.log("   airdrop rejected:", JSON.stringify(r.error ?? r).slice(0, 120));
    return false;
  }
  for (let i = 0; i < 25; i++) {
    if ((await conn.getBalance(pk)) > 0) return true;
    await sleep(1500);
  }
  return false;
}

const ORCH = process.env.ORCH ?? "http://localhost:4100";
const TREASURY = process.env.TREASURY_ADDRESS ?? "DDEqi2y5YLsEUYdavkfEHKbJmSxF4TfA8Xj99LqerV5m";
const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const AMOUNT_SOL = 0.05;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function token(userId: string): Promise<string> {
  const r = await fetch(`${ORCH}/auth/dev`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  }).then((x) => x.json());
  return r.token as string;
}

async function postDeposit(tok: string, signature: string) {
  const r = await fetch(`${ORCH}/credits/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ signature }),
  });
  return { status: r.status, body: await r.json() };
}

async function main() {
  const conn = new Connection(clusterApiUrl("devnet"), "confirmed");
  const payer = loadPayer();
  console.log("payer:", payer.publicKey.toBase58());

  console.log("1) ensuring payer is funded on devnet…");
  const funded = await rawAirdrop(conn, payer.publicKey);
  if (!funded) {
    console.log(
      "\nSKIP — devnet faucet is rate-limited right now. Fund this address from",
      "\n  https://faucet.solana.com  (paste:",
      payer.publicKey.toBase58() + ") and re-run.",
    );
    process.exit(2);
  }
  console.log("   funded:", (await conn.getBalance(payer.publicKey)) / 1e9, "SOL");

  const userId = "depositor-" + payer.publicKey.toBase58().slice(0, 6).toLowerCase();
  const tok = await token(userId);

  console.log(`2) paying ${AMOUNT_SOL} SOL to treasury with memo 0c:${userId}…`);
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: new PublicKey(TREASURY),
      lamports: Math.round(AMOUNT_SOL * 1e9),
    }),
    new TransactionInstruction({ keys: [], programId: MEMO, data: Buffer.from(`0c:${userId}`, "utf8") }),
  );
  const signature = await sendAndConfirmTransaction(conn, tx, [payer], { commitment: "confirmed" });
  console.log("   signature:", signature);

  console.log("3) crediting via /credits/deposit…");
  const first = await postDeposit(tok, signature);
  console.log("   ->", JSON.stringify(first.body));

  console.log("4) idempotency: submit the SAME signature again…");
  const second = await postDeposit(tok, signature);
  console.log("   ->", JSON.stringify(second.body));

  console.log("5) security: a DIFFERENT user tries to claim the same signature…");
  const attacker = await token("attacker");
  const stolen = await postDeposit(attacker, signature);
  console.log(`   -> status ${stolen.status}: ${JSON.stringify(stolen.body)}`);

  const expected = Math.floor(AMOUNT_SOL * 150 * 100);
  const pass =
    first.body.credited === true &&
    first.body.credits === expected &&
    second.body.credited === false &&
    second.body.balance === first.body.balance &&
    stolen.status === 400;
  console.log("\n" + (pass ? "OK — deposit on-ramp verified." : "FAIL — see output above."));
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
