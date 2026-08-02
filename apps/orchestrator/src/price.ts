/**
 * ETH/USD price with layered sources and a short cache:
 *   1. Pyth (Hermes) — a decentralized on-chain oracle, primary.
 *   2. CoinGecko — secondary.
 *   3. Fixed ETH_USD_PRICE fallback — so deposits never break on mainnet.
 */
const PYTH_ETH_USD = "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

async function fromPyth(): Promise<number | null> {
  try {
    const res = await fetch(
      `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${PYTH_ETH_USD}`,
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
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { signal: AbortSignal.timeout(3000) },
    );
    const json = (await res.json()) as { ethereum?: { usd?: number } };
    const v = json?.ethereum?.usd;
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

  async function getEthUsd(): Promise<number> {
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

  return { getEthUsd, priceSource: () => source };
}
