/**
 * $0C buyback-and-burn keeper.
 *
 * Uses a slice of treasury SOL to buy $0C on the open market (via Jupiter) and
 * burns it — deflationary support that does NOT put the token in the redemption
 * path (see WHITEPAPER "Reserve"). Run on a schedule (cron / Railway cron).
 *
 * Activates only when KEEPER_ENABLED=true and $0C is tradeable (has a pool).
 * Until then, quotes return "no route" and the keeper no-ops safely.
 *
 * Env: KEEPER_ENABLED, TREASURY_SECRET_KEY, SOLANA_RPC_URL, BUYBACK_SOL (SOL per
 * run, default 0.05), KEEPER_DRY_RUN (default true), and OC_MINT — the $0C mint
 * address. OC_MINT is required and lives only in the server environment; the
 * mint is never bundled into the site.
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { createBurnCheckedInstruction, getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import { TOKEN } from "@0c/credits";
import { loadKeypair } from "../src/payout.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

const SOL_MINT = "So11111111111111111111111111111111111111112";
const OC_MINT = process.env.OC_MINT ?? "";
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const BUYBACK_SOL = Number(process.env.BUYBACK_SOL ?? 0.05);
const DRY_RUN = process.env.KEEPER_DRY_RUN !== "false";

async function main() {
  if (process.env.KEEPER_ENABLED !== "true") {
    console.log("[keeper] disabled (set KEEPER_ENABLED=true).");
    return;
  }
  if (!process.env.TREASURY_SECRET_KEY) {
    console.log("[keeper] no TREASURY_SECRET_KEY — cannot sign.");
    return;
  }
  if (!OC_MINT) {
    console.log("[keeper] no OC_MINT set — nothing to buy back.");
    return;
  }
  const treasury = loadKeypair(process.env.TREASURY_SECRET_KEY);
  const connection = new Connection(RPC, "confirmed");
  const lamports = Math.round(BUYBACK_SOL * 1e9);
  console.log(`[keeper] buyback-and-burn: ${BUYBACK_SOL} SOL -> ${TOKEN.ticker} (${OC_MINT})${DRY_RUN ? " [DRY RUN]" : ""}`);

  // 1) quote SOL -> $0C (Jupiter). Network/no-route failures no-op safely.
  let quote: any;
  try {
    quote = await fetch(
      `https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${OC_MINT}&amount=${lamports}&slippageBps=150`,
    ).then((r) => r.json());
  } catch (e) {
    console.log("[keeper] quote request failed (network). No-op.", e instanceof Error ? e.message : e);
    return;
  }
  if (!quote || quote.error || !quote.outAmount) {
    console.log("[keeper] not tradeable yet / no route. No-op.", quote?.error ?? "");
    return;
  }
  const outTokens = Number(quote.outAmount) / 10 ** TOKEN.decimals;
  console.log(`[keeper] quote: ~${outTokens.toLocaleString()} ${TOKEN.ticker}`);
  if (DRY_RUN) {
    console.log("[keeper] DRY RUN — not executing. Set KEEPER_DRY_RUN=false to go live.");
    return;
  }

  // 2) swap
  const { swapTransaction } = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: treasury.publicKey.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
  }).then((r) => r.json());
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
  tx.sign([treasury]);
  const swapSig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(swapSig, "confirmed");
  console.log(`[keeper] bought ${TOKEN.ticker}: ${swapSig}`);

  // 3) burn everything the treasury holds of $0C
  const mint = new PublicKey(OC_MINT);
  const ata = await getAssociatedTokenAddress(mint, treasury.publicKey);
  const acct = await getAccount(connection, ata);
  if (acct.amount > 0n) {
    const { Transaction } = await import("@solana/web3.js");
    const burnTx = new Transaction().add(
      createBurnCheckedInstruction(ata, mint, treasury.publicKey, acct.amount, TOKEN.decimals),
    );
    burnTx.feePayer = treasury.publicKey;
    burnTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    burnTx.sign(treasury);
    const burnSig = await connection.sendRawTransaction(burnTx.serialize());
    await connection.confirmTransaction(burnSig, "confirmed");
    console.log(`[keeper] burned ${Number(acct.amount) / 10 ** TOKEN.decimals} ${TOKEN.ticker}: ${burnSig}`);
  }
}

main().catch((e) => { console.error("[keeper]", e); process.exit(1); });
