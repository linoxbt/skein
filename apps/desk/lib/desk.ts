import { Skein } from "@skeinlabs/sdk";
import { networkFromEnv, TelegraphClient, viemSigner } from "@skein/telegraph";
import type { AgentDeps } from "./agent";
import { defaultStore } from "./store";

/**
 * The Desk's wiring, from the environment:
 *   SKEIN_API_URL            the Skein API (default: the hosted one)
 *   SKEIN_WEB_URL            where verdict pages live (for links in letters)
 *   DESK_PAYER               apiKey (default) or telegraph
 *   DESK_SKEIN_KEY           the Desk's Skein partner key (apiKey rail)
 *   DESK_PAYER_KEY           a burner private key with escrow funds (telegraph rail)
 *   SKEIN_MINER_ID           pin the Skein miner on Telegraph (otherwise routed by intent)
 *   DESK_MAX_USDC_PER_CALL   default 0.30; the Telegraph client refuses any 402 above it
 */
export const SKEIN_API_URL = process.env.SKEIN_API_URL ?? "https://api.skeinlabs.site";
export const SKEIN_WEB_URL = process.env.SKEIN_WEB_URL ?? "https://skeinlabs.site";

export function payerRail(): "apiKey" | "telegraph" {
  return process.env.DESK_PAYER === "telegraph" ? "telegraph" : "apiKey";
}

function skeinFromEnv(): Skein | null {
  const maxUsdcPerCall = Number(process.env.DESK_MAX_USDC_PER_CALL ?? 0.3);
  if (payerRail() === "telegraph") {
    const key = process.env.DESK_PAYER_KEY as `0x${string}` | undefined;
    if (!key) return null;
    const client = new TelegraphClient({ network: networkFromEnv(), signer: viemSigner(key), maxUusdcPerCall: Math.round(maxUsdcPerCall * 1e6) });
    const minerId = process.env.SKEIN_MINER_ID;
    return new Skein({ apiUrl: SKEIN_API_URL, payer: { kind: "telegraph", client, ...(minerId ? { minerId } : {}) }, maxUsdcPerCall, timeoutMs: 25_000 });
  }
  const key = process.env.DESK_SKEIN_KEY;
  return key ? new Skein({ apiUrl: SKEIN_API_URL, payer: { kind: "apiKey", key }, maxUsdcPerCall, timeoutMs: 20_000 }) : null;
}

export async function deskDeps(overrides: Partial<AgentDeps> = {}): Promise<AgentDeps> {
  return { store: await defaultStore(), skein: skeinFromEnv(), rail: payerRail(), webUrl: SKEIN_WEB_URL, ...overrides };
}

/** Applications a day the public form accepts in total, and per visitor address. */
/**
 * Applications from the public form per UTC day. Each buys at most one verdict
 * under dex-list (budget 0.13 USDC), so the form can spend at most 20 x 0.13 =
 * 2.6 USDC a day: about a quarter of the API's 10 USDC daily cap, leaving the
 * rest for partners. Webhook intake needs DESK_WEBHOOK_SECRET.
 */
export const DAILY_LIMIT = Number(process.env.DESK_DAILY_APPLICATIONS ?? 20);
export const PER_IP_DAILY_LIMIT = Number(process.env.DESK_DAILY_PER_IP ?? 5);
