import { Connection, PublicKey } from "@solana/web3.js";

/**
 * $0C holder gate for the public X bot.
 *
 *   >= HOLD_TIER1  ->  allowed, capped requests/day
 *   >= HOLD_TIER2  ->  unlimited
 *
 * Thresholds are env-tunable because the dollar value of a fixed token amount
 * moves with price — what gates fairly at launch may be prohibitive later.
 * The mint lives only in the server env (OC_MINT); it is never shipped to the site.
 */
export interface GateConfig {
  mint: string;
  rpcUrl: string;
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
    mint: process.env.OC_MINT ?? "",
    rpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    tier1: Number(process.env.XBOT_TIER1_TOKENS ?? 1_000_000),
    tier2: Number(process.env.XBOT_TIER2_TOKENS ?? 10_000_000),
    tier1DailyLimit: Number(process.env.XBOT_TIER1_DAILY ?? 5),
  };
}

export function makeTokenGate(cfg: GateConfig) {
  /** True once $0C exists and the gate can be enforced for real. */
  const configured = !!cfg.mint;
  const connection = configured ? new Connection(cfg.rpcUrl, "confirmed") : null;

  /** Total $0C held by a wallet across its token accounts (UI amount). */
  async function balanceOf(wallet: string): Promise<number> {
    if (!connection || !cfg.mint) return 0;
    try {
      const res = await connection.getParsedTokenAccountsByOwner(new PublicKey(wallet), {
        mint: new PublicKey(cfg.mint),
      });
      let total = 0;
      for (const { account } of res.value) {
        const amt = (account.data as any)?.parsed?.info?.tokenAmount?.uiAmount;
        if (typeof amt === "number") total += amt;
      }
      return total;
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
