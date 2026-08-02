/**
 * $0C buyback-and-burn keeper.
 *
 * Uses a slice of treasury ETH to buy $0C on the open market (via Uniswap V3)
 * and burns it — deflationary support that does NOT put the token in the
 * redemption path (see WHITEPAPER "Reserve"). Run on a schedule (cron / Railway
 * cron).
 *
 * Activates only when KEEPER_ENABLED=true and $0C is tradeable (has a pool).
 * Until then, quoting reverts with "no route" and the keeper no-ops safely.
 *
 * Env: KEEPER_ENABLED, TREASURY_PRIVATE_KEY, ETH_RPC_URL, BUYBACK_ETH (ETH per
 * run, default 0.02), KEEPER_DRY_RUN (default true), UNISWAP_FEE_TIER (default
 * 3000 = 0.3%), and OC_TOKEN — the $0C contract address. OC_TOKEN is required
 * and lives only in the server environment; it is never bundled into the site.
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatUnits,
  erc20Abi,
  isAddress,
} from "viem";
import { mainnet } from "viem/chains";
import { TOKEN } from "@0c/credits";
import { loadAccount } from "../src/payout.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const QUOTER_V2 = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
const SWAP_ROUTER_02 = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
/**
 * Burning by transfer to the standard eater address works for any ERC-20.
 * $0C is not deployed yet, so we can't assume it exposes a `burn()`.
 */
const DEAD = "0x000000000000000000000000000000000000dEaD";

const OC_TOKEN = process.env.OC_TOKEN ?? "";
const RPC = process.env.ETH_RPC_URL ?? "https://eth.llamarpc.com";
const BUYBACK_ETH = Number(process.env.BUYBACK_ETH ?? 0.02);
const FEE_TIER = Number(process.env.UNISWAP_FEE_TIER ?? 3000);
const DRY_RUN = process.env.KEEPER_DRY_RUN !== "false";

const quoterAbi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        type: "tuple",
        name: "params",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

const routerAbi = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        type: "tuple",
        name: "params",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

async function main() {
  if (process.env.KEEPER_ENABLED !== "true") {
    console.log("[keeper] disabled (set KEEPER_ENABLED=true).");
    return;
  }
  if (!process.env.TREASURY_PRIVATE_KEY) {
    console.log("[keeper] no TREASURY_PRIVATE_KEY — cannot sign.");
    return;
  }
  if (!isAddress(OC_TOKEN, { strict: false })) {
    console.log("[keeper] no valid OC_TOKEN set — nothing to buy back.");
    return;
  }

  const account = loadAccount(process.env.TREASURY_PRIVATE_KEY);
  const publicClient = createPublicClient({ chain: mainnet, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain: mainnet, transport: http(RPC) });
  const amountIn = parseEther(String(BUYBACK_ETH));
  console.log(
    `[keeper] buyback-and-burn: ${BUYBACK_ETH} ETH -> ${TOKEN.ticker} (${OC_TOKEN})${DRY_RUN ? " [DRY RUN]" : ""}`,
  );

  // 1) quote ETH -> $0C. No pool yet means this reverts, which we treat as a no-op.
  let amountOut: bigint;
  try {
    const { result } = await publicClient.simulateContract({
      address: QUOTER_V2,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [
        {
          tokenIn: WETH,
          tokenOut: OC_TOKEN as `0x${string}`,
          amountIn,
          fee: FEE_TIER,
          sqrtPriceLimitX96: 0n,
        },
      ],
      account,
    });
    amountOut = result[0];
  } catch (e) {
    console.log(
      "[keeper] not tradeable yet / no route. No-op.",
      e instanceof Error ? e.message.split("\n")[0] : e,
    );
    return;
  }
  if (amountOut <= 0n) {
    console.log("[keeper] quote returned zero. No-op.");
    return;
  }

  console.log(`[keeper] quote: ~${Number(formatUnits(amountOut, TOKEN.decimals)).toLocaleString()} ${TOKEN.ticker}`);
  if (DRY_RUN) {
    console.log("[keeper] DRY RUN — not executing. Set KEEPER_DRY_RUN=false to go live.");
    return;
  }

  // 2) swap, accepting 1.5% slippage against the quote
  const minOut = (amountOut * 985n) / 1000n;
  const swapHash = await wallet.writeContract({
    address: SWAP_ROUTER_02,
    abi: routerAbi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: WETH,
        tokenOut: OC_TOKEN as `0x${string}`,
        fee: FEE_TIER,
        recipient: account.address,
        amountIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      },
    ],
    value: amountIn, // router wraps ETH into WETH for us
  });
  await publicClient.waitForTransactionReceipt({ hash: swapHash });
  console.log(`[keeper] bought ${TOKEN.ticker}: ${swapHash}`);

  // 3) burn everything the treasury holds of $0C
  const balance = await publicClient.readContract({
    address: OC_TOKEN as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  if (balance > 0n) {
    const burnHash = await wallet.writeContract({
      address: OC_TOKEN as `0x${string}`,
      abi: erc20Abi,
      functionName: "transfer",
      args: [DEAD, balance],
    });
    await publicClient.waitForTransactionReceipt({ hash: burnHash });
    console.log(
      `[keeper] burned ${Number(formatUnits(balance, TOKEN.decimals)).toLocaleString()} ${TOKEN.ticker}: ${burnHash}`,
    );
  }
}

main().catch((e) => {
  console.error("[keeper]", e);
  process.exit(1);
});
