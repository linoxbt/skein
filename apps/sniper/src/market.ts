/**
 * Free market data for the pre-check, from DEX Screener's public token
 * endpoint (no key; up to 30 tokens per call). It decides only *whether a
 * token is worth a paid verdict yet* (is there liquidity to trade against?),
 * and tracks the price of every checked token afterwards. It never decides a
 * trade: only the Skein verdict does.
 */
export interface Market {
  token: string;
  symbol: string | null;
  name: string | null;
  priceUsd: number | null;
  liquidityUsd: number;
  /** The deepest pair's address, when it is a 0x address (v4 pools are ids). */
  pair: string | null;
  dex: string | null;
  url: string | null;
}

interface Pair {
  dexId: string;
  url?: string;
  pairAddress: string;
  priceUsd?: string;
  liquidity?: { usd?: number };
  baseToken: { address: string; name?: string; symbol?: string };
  quoteToken: { address: string };
}

export interface MarketSource {
  get(tokens: string[]): Promise<Map<string, Market>>;
}

export function dexScreener(base = "https://api.dexscreener.com"): MarketSource {
  return {
    async get(tokens) {
      const out = new Map<string, Market>();
      for (let i = 0; i < tokens.length; i += 30) {
        const batch = tokens.slice(i, i + 30);
        const r = await fetch(`${base}/tokens/v1/base/${batch.join(",")}`, { signal: AbortSignal.timeout(15_000) });
        if (!r.ok) throw new Error(`dexscreener: HTTP ${r.status}`);
        for (const p of (await r.json()) as Pair[]) {
          // A pair lists the token as base or quote; the price is only the token's own when it is the base.
          const token = p.baseToken.address.toLowerCase();
          if (!batch.includes(token)) continue;
          const liq = p.liquidity?.usd ?? 0;
          const have = out.get(token);
          if (have && have.liquidityUsd >= liq) continue;
          out.set(token, {
            token,
            symbol: p.baseToken.symbol ?? null,
            name: p.baseToken.name ?? null,
            priceUsd: p.priceUsd ? Number(p.priceUsd) : null,
            liquidityUsd: liq,
            pair: /^0x[0-9a-fA-F]{40}$/.test(p.pairAddress) ? p.pairAddress.toLowerCase() : null,
            dex: p.dexId,
            url: p.url ?? null,
          });
        }
      }
      return out;
    },
  };
}
