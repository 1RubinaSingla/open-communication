import { createPublicClient, http, formatUnits, erc20Abi, isAddress } from "viem";
import { mainnet, sepolia } from "viem/chains";

/**
 * $0C holder gate for the public X bot.
 *
 *   >= HOLD_TIER1  ->  allowed, capped requests/day
 *   >= HOLD_TIER2  ->  unlimited
 *
 * Thresholds are env-tunable because the dollar value of a fixed token amount
 * moves with price — what gates fairly at launch may be prohibitive later.
 * The token address lives only in the server env (OC_TOKEN); it is never
 * shipped to the site.
 */
export interface GateConfig {
  token: string;
  rpcUrl: string;
  chain: "mainnet" | "sepolia";
  tier1: number; // tokens for limited access
  tier2: number; // tokens for unlimited
  tier1DailyLimit: number;
}

export type Tier = "none" | "limited" | "unlimited";

export interface GateResult {
  tier: Tier;
  balance: number;
  /** null = unlimited */
  dailyLimit: number | null;
}

export function gateConfigFromEnv(): GateConfig {
  return {
    token: process.env.OC_TOKEN ?? "",
    rpcUrl: process.env.ETH_RPC_URL ?? "https://eth.llamarpc.com",
    chain: (process.env.ETH_CHAIN as "mainnet" | "sepolia") ?? "mainnet",
    tier1: Number(process.env.XBOT_TIER1_TOKENS ?? 1_000_000),
    tier2: Number(process.env.XBOT_TIER2_TOKENS ?? 10_000_000),
    tier1DailyLimit: Number(process.env.XBOT_TIER1_DAILY ?? 5),
  };
}

export function makeTokenGate(cfg: GateConfig) {
  /** True once $0C exists and the gate can be enforced for real. */
  const configured = !!cfg.token && isAddress(cfg.token, { strict: false });
  const client = configured
    ? createPublicClient({
        chain: cfg.chain === "mainnet" ? mainnet : sepolia,
        transport: http(cfg.rpcUrl),
      })
    : null;

  // Read once and reuse: a token's decimals are immutable.
  let decimals: number | null = null;

  /** $0C held by a wallet, as a human-readable amount. */
  async function balanceOf(wallet: string): Promise<number> {
    if (!client || !isAddress(wallet, { strict: false })) return 0;
    try {
      const token = cfg.token as `0x${string}`;
      if (decimals == null) {
        decimals = await client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "decimals",
        });
      }
      const raw = await client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet as `0x${string}`],
      });
      return Number(formatUnits(raw, decimals));
    } catch {
      return 0;
    }
  }

  /** Pure tier decision — unit-testable without touching the chain. */
  function tierFor(balance: number): GateResult {
    if (balance >= cfg.tier2) return { tier: "unlimited", balance, dailyLimit: null };
    if (balance >= cfg.tier1) return { tier: "limited", balance, dailyLimit: cfg.tier1DailyLimit };
    return { tier: "none", balance, dailyLimit: 0 };
  }

  async function check(wallet: string): Promise<GateResult> {
    return tierFor(await balanceOf(wallet));
  }

  return { configured, balanceOf, tierFor, check, cfg };
}
