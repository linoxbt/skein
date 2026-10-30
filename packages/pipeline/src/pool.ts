import { SUPPORTED_CHAINS } from "@skein/engine";

/** Finds a token's main pool, which LIQUIDITY_DEPTH_VERIFY needs as input. */
export interface PoolResolver {
  resolve(chainId: number, token: string): Promise<string | null>;
}

const DEXSCREENER_CHAIN: Record<string, string> = { ethereum: "ethereum", base: "base", bsc: "bsc", arbitrum: "arbitrum" };

/**
 * Resolves the deepest pool from DexScreener's public token endpoint. This is
 * a lookup of where to point the paid liquidity check, not evidence: the
 * reserve figure itself is bought through Telegraph. Disclosed as a
 * non-Telegraph dependency.
 */
export function dexScreenerResolver(fetchImpl: typeof fetch = fetch): PoolResolver {
  return {
    async resolve(chainId, token) {
      const chain = DEXSCREENER_CHAIN[SUPPORTED_CHAINS[chainId] ?? ""];
      if (!chain) return null;
      try {
        const res = await fetchImpl(`https://api.dexscreener.com/latest/dex/tokens/${token}`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return null;
        const body = (await res.json()) as { pairs?: { chainId?: string; pairAddress?: string; liquidity?: { usd?: number } }[] };
        const pairs = (body.pairs ?? []).filter(
          (p) => p.chainId === chain && typeof p.pairAddress === "string" && /^0x[0-9a-fA-F]{40}$/.test(p.pairAddress),
        );
        pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
        return pairs[0]?.pairAddress?.toLowerCase() ?? null;
      } catch {
        return null;
      }
    },
  };
}
