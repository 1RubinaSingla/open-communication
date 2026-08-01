/**
 * SOL/USD price with layered sources and a short cache:
 *   1. Pyth (Hermes) — a decentralized on-chain oracle, primary.
 *   2. CoinGecko — secondary.
 *   3. Fixed SOL_USD_PRICE fallback — so deposits never break on mainnet.
 */
const PYTH_SOL_USD = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

async function fromPyth(): Promise<number | null> {
  try {
    const res = await fetch(
      `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${PYTH_SOL_USD}`,
      { signal: AbortSignal.timeout(3000) },
    );
    const json = (await res.json()) as { parsed?: Array<{ price?: { price?: string; expo?: number } }> };
    const p = json?.parsed?.[0]?.price;
    if (p?.price != null && p.expo != null) {
      const v = Number(p.price) * 10 ** p.expo;
      if (v > 0) return v;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function fromCoinGecko(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { signal: AbortSignal.timeout(3000) },
    );
    const json = (await res.json()) as { solana?: { usd?: number } };
    const v = json?.solana?.usd;
    if (typeof v === "number" && v > 0) return v;
  } catch {
    /* ignore */
  }
  return null;
}

export function makePrice(fallback: number, ttlMs = 60_000) {
  let cached = 0;
  let at = 0;
  let source = "fallback";

  async function getSolUsd(): Promise<number> {
    const now = Date.now();
    if (cached > 0 && now - at < ttlMs) return cached;
    const pyth = await fromPyth();
    if (pyth) {
      cached = pyth;
      at = now;
      source = "pyth";
      return pyth;
    }
    const cg = await fromCoinGecko();
    if (cg) {
      cached = cg;
      at = now;
      source = "coingecko";
      return cg;
    }
    source = cached > 0 ? "cache" : "fallback";
    return cached > 0 ? cached : fallback;
  }

  return { getSolUsd, priceSource: () => source };
}
