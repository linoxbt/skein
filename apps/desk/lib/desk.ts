import { Skein } from "@skein/sdk";
import type { AgentDeps } from "./agent";
import { defaultStore } from "./store";

/**
 * The Desk's wiring, from the environment:
 *   SKEIN_API_URL            the Skein API (default: the hosted one)
 *   SKEIN_WEB_URL            where verdict pages live (for links in letters)
 *   DESK_SKEIN_KEY           the Desk's Skein partner key (the partner-key rail)
 *   DESK_PAYER=telegraph     pay through Telegraph instead, with a TelegraphAsker
 *                            wired in by a fork (see README); off until Skein's
 *                            miner is registered
 *   DESK_MAX_USDC_PER_CALL   default 0.30
 */
export const SKEIN_API_URL = process.env.SKEIN_API_URL ?? "https://api-production-9396.up.railway.app";
export const SKEIN_WEB_URL = process.env.SKEIN_WEB_URL ?? "https://skein-web.netlify.app";

export async function deskDeps(overrides: Partial<AgentDeps> = {}): Promise<AgentDeps> {
  const key = process.env.DESK_SKEIN_KEY;
  const skein = key
    ? new Skein({ apiUrl: SKEIN_API_URL, payer: { kind: "apiKey", key }, maxUsdcPerCall: Number(process.env.DESK_MAX_USDC_PER_CALL ?? 0.3), timeoutMs: 20_000 })
    : null;
  return { store: await defaultStore(), skein, rail: "apiKey", webUrl: SKEIN_WEB_URL, ...overrides };
}

/** Applications a day the public form accepts, so a stranger cannot spend the Desk's key. */
export const DAILY_LIMIT = Number(process.env.DESK_DAILY_APPLICATIONS ?? 40);
