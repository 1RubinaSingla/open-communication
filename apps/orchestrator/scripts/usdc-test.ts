/** Unit test for USDC deposit detection via token-balance deltas. */
import { usdcDelta } from "../src/solana.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TRE = "A3xYj8pUJYN5pegc5TqW1M35Tj8By13PCvNqpfV7RYvY";
const bal = (idx: number, owner: string, mint: string, ui: number) => ({
  accountIndex: idx,
  mint,
  owner,
  uiTokenAmount: { uiAmount: ui, amount: String(ui * 1e6), decimals: 6 },
});

let pass = true;
const check = (n: string, ok: boolean) => { console.log(`   ${ok ? "✓" : "✗"} ${n}`); if (!ok) pass = false; };

// treasury receives 5 USDC into a fresh account (pre absent)
check("fresh account credit +5", usdcDelta([], [bal(3, TRE, USDC, 5)], TRE, USDC) === 5);
// treasury already had 2, now 7 → +5
check("delta on existing account (+5)", usdcDelta([bal(3, TRE, USDC, 2)], [bal(3, TRE, USDC, 7)], TRE, USDC) === 5);
// transfer to a different owner → 0 for treasury
check("ignores other owners", usdcDelta([], [bal(3, "SomeOtherOwner1111", USDC, 5)], TRE, USDC) === 0);
// wrong mint → 0
check("ignores wrong mint", usdcDelta([], [bal(3, TRE, "WrongMint111111111111", 5)], TRE, USDC) === 0);
// credits math: 5 USDC = 500 credits
check("5 USDC → 500 credits", Math.floor(usdcDelta([], [bal(3, TRE, USDC, 5)], TRE, USDC) * 100) === 500);

console.log("\n" + (pass ? "OK — USDC detection verified." : "FAIL — see above."));
process.exit(pass ? 0 : 1);
