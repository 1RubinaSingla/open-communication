/**
 * Security core of the Ethereum on-ramp, tested offline.
 *
 * With no memo program on Ethereum, a payment is bound to an account purely by
 * *which address it landed in* — so the tests that matter most are the ones
 * proving a deposit into someone else's address, or of a lookalike token,
 * cannot credit you.
 */
import { mnemonicToAccount } from "viem/accounts";
import { parseEther, parseUnits, pad, toHex } from "viem";
import { createDb } from "@0c/db";
import { interpretTx, usdtDelta, topicToAddress, USDT_MAINNET, USDT_DECIMALS } from "../src/eth.js";
import type { RawLog, RawReceipt, RawTx } from "../src/eth.js";

// Hardhat's well-known public test mnemonic — never used for real funds.
const MNEMONIC = "test test test test test test test test test test test junk";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const CFG = { usdtAddress: USDT_MAINNET, ethUsdPrice: 3000, confirmations: 3 };
const HEAD = 100n;

let pass = true;
const check = (n: string, ok: boolean) => {
  console.log(`   ${ok ? "✓" : "✗"} ${n}`);
  if (!ok) pass = false;
};
/** interpretTx throws on every rejection path; this asserts it rejected. */
const rejects = (n: string, fn: () => unknown) => {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  check(n, threw);
};

const addr = (i: number) => mnemonicToAccount(MNEMONIC, { addressIndex: i }).address;
const MINE = addr(0);
const THEIRS = addr(1);
const SENDER = "0x1111111111111111111111111111111111111111";

const tx = (to: string | null, value: bigint): RawTx => ({ to, from: SENDER, value });
const receipt = (
  logs: RawLog[] = [],
  status: "success" | "reverted" = "success",
  blockNumber = 90n,
): RawReceipt => ({ status, blockNumber, logs });
const transferLog = (token: string, to: string, amount: bigint): RawLog => ({
  address: token,
  topics: [TRANSFER_TOPIC, pad(SENDER as `0x${string}`), pad(to as `0x${string}`)],
  data: toHex(amount),
});

console.log("1) deposit addresses are derived, deterministic and distinct");
check("same index → same address", addr(0) === MINE);
check("different index → different address", MINE !== THEIRS);
check("addresses look like 0x + 40 hex", /^0x[0-9a-fA-F]{40}$/.test(MINE));

console.log("2) native ETH credits at the live rate");
const ethOk = interpretTx(tx(MINE, parseEther("0.01")), receipt(), HEAD, CFG, MINE);
check("currency is ETH", ethOk.currency === "ETH");
check("0.01 ETH @ $3000 = 3000 credits", ethOk.credits === 3000);
check("sender recorded", ethOk.sender === SENDER);

console.log("3) a payment into someone else's address cannot credit you");
rejects("ETH sent to another user's deposit address", () =>
  interpretTx(tx(THEIRS, parseEther("1")), receipt(), HEAD, CFG, MINE),
);
rejects("USDT sent to another user's deposit address", () =>
  interpretTx(
    tx(null, 0n),
    receipt([transferLog(USDT_MAINNET, THEIRS, parseUnits("100", USDT_DECIMALS))]),
    HEAD,
    CFG,
    MINE,
  ),
);

console.log("4) on-chain failure and finality");
rejects("reverted transaction", () =>
  interpretTx(tx(MINE, parseEther("1")), receipt([], "reverted"), HEAD, CFG, MINE),
);
rejects("too few confirmations", () =>
  interpretTx(tx(MINE, parseEther("1")), receipt([], "success", HEAD), HEAD, CFG, MINE),
);
check(
  "exactly at the confirmation floor is accepted",
  interpretTx(tx(MINE, parseEther("1")), receipt([], "success", HEAD - 2n), HEAD, CFG, MINE).credits >
    0,
);

console.log("5) USDT is read from Transfer logs at 1 USDT = $1");
const usdtOk = interpretTx(
  tx(null, 0n),
  receipt([transferLog(USDT_MAINNET, MINE, parseUnits("25", USDT_DECIMALS))]),
  HEAD,
  CFG,
  MINE,
);
check("currency is USDT", usdtOk.currency === "USDT");
check("25 USDT = 2500 credits", usdtOk.credits === 2500);

console.log("6) a lookalike token cannot mint credits");
rejects("Transfer log from a different token contract", () =>
  interpretTx(
    tx(null, 0n),
    receipt([
      transferLog(
        "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        MINE,
        parseUnits("1000000", USDT_DECIMALS),
      ),
    ]),
    HEAD,
    CFG,
    MINE,
  ),
);

console.log("7) log parsing");
check(
  "usdtDelta sums multiple transfers to the same address",
  usdtDelta(
    [
      transferLog(USDT_MAINNET, MINE, parseUnits("10", USDT_DECIMALS)),
      transferLog(USDT_MAINNET, MINE, parseUnits("5", USDT_DECIMALS)),
      transferLog(USDT_MAINNET, THEIRS, parseUnits("999", USDT_DECIMALS)),
    ],
    USDT_MAINNET,
    MINE,
  ) === 15,
);
check(
  "topicToAddress unpads a 32-byte topic",
  topicToAddress(pad(MINE as `0x${string}`)) === MINE.toLowerCase(),
);
check(
  "address match ignores checksum casing",
  usdtDelta(
    [transferLog(USDT_MAINNET.toLowerCase(), MINE.toLowerCase(), parseUnits("1", USDT_DECIMALS))],
    USDT_MAINNET,
    MINE,
  ) === 1,
);

console.log("8) dust cannot be credited");
rejects("deposit rounding to zero credits", () =>
  interpretTx(tx(MINE, 1n), receipt(), HEAD, CFG, MINE),
);
rejects("empty transaction", () => interpretTx(tx(MINE, 0n), receipt(), HEAD, CFG, MINE));

console.log("9) crediting is idempotent against a real ledger");
const db = createDb(":memory:", { signupGrant: 0 });
db.ensureUser("alice");
const HASH = "0xAbCdEf0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const first = db.creditDeposit("alice", 3000, HASH);
check("first credit lands", first.credited && first.balance === 3000);
check("replaying the same hash is a no-op", db.creditDeposit("alice", 3000, HASH).credited === false);
// The ledger lowercases the ref, so a differently-cased hash is still the same
// transaction and must not credit twice.
check(
  "same hash in different case does not double-credit",
  db.creditDeposit("alice", 3000, HASH.toLowerCase()).credited === false,
);
check("balance unchanged after replays", db.balanceOf("alice") === 3000);
check("deposits count toward the withdrawal cap", db.withdrawableOf("alice") === 3000);

console.log("10) deposit indices are stable and unique per account");
const iAlice = db.depositIndexFor("alice");
const iBob = db.depositIndexFor("bob");
check("index is stable across calls", db.depositIndexFor("alice") === iAlice);
check("different accounts get different indices", iAlice !== iBob);
check(
  "and therefore different deposit addresses",
  addr(iAlice) !== addr(iBob),
);

console.log("\n" + (pass ? "OK — Ethereum deposit logic verified." : "FAIL — see above."));
process.exit(pass ? 0 : 1);
