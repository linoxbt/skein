import { Skein } from "@skeinlabs/sdk";
import { networkFromEnv, TelegraphClient, viemSigner } from "@skein/telegraph";
import type { AgentDeps, TelegraphSkein } from "./agent";
import { defaultStore } from "./store";

/**
 * The Desk's wiring, from the environment:
 *   SKEIN_API_URL              the Skein API (default: the hosted one)
 *   SKEIN_WEB_URL              where verdict pages live (for links in letters)
 *   DESK_PAYER                 apiKey (default) or telegraph
 *   DESK_SKEIN_KEY             the Desk's Skein partner key: the apiKey rail, the store (/v1/kv), and
 *                              on the Telegraph rail the fallback for form applications past the day's allowance
 *   DESK_PAYER_KEY             a burner private key with escrow funds (telegraph rail)
 *   DESK_INTENT                the Telegraph intent to ask (default FRAUD_RISK_GENERAL, the canonical one Skein serves)
 *   SKEIN_MINER_ID             the Skein miner to pin on Telegraph (default 845301; "routed" lets the node choose)
 *   DESK_MAX_USDC_PER_CALL     default 0.30; the Telegraph client refuses any 402 above it
 *   DESK_TELEGRAPH_TIMEOUT_MS  one Telegraph call, default 45000 (above the miner's 25 s deadline plus the node's hop)
 *   DESK_TELEGRAPH_FORM_DAILY  form and webhook applications a UTC day bought through Telegraph (default 1)
 *   DESK_AUTO_DAILY            applications the agent files itself from fresh launches a UTC day (default 1; 0 turns it off)
 */
export const SKEIN_API_URL = process.env.SKEIN_API_URL ?? "https://api.skeinlabs.site";
export const SKEIN_WEB_URL = process.env.SKEIN_WEB_URL ?? "https://skeinlabs.site";
/** Skein's registration on the Telegraph testnet, under FRAUD_RISK_GENERAL (miner/skein-miner.plan-b.yaml). */
export const SKEIN_MINER_ID = "845301";
export const DESK_INTENT = "FRAUD_RISK_GENERAL";

export function payerRail(): "apiKey" | "telegraph" {
  return process.env.DESK_PAYER === "telegraph" ? "telegraph" : "apiKey";
}

const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

function partnerFromEnv(maxUsdcPerCall: number): Skein | null {
  const key = process.env.DESK_SKEIN_KEY;
  return key ? new Skein({ apiUrl: SKEIN_API_URL, payer: { kind: "apiKey", key }, maxUsdcPerCall, timeoutMs: 20_000 }) : null;
}

function telegraphFromEnv(maxUsdcPerCall: number): TelegraphSkein | null {
  const key = process.env.DESK_PAYER_KEY as `0x${string}` | undefined;
  if (payerRail() !== "telegraph" || !key) return null;
  let client: TelegraphClient;
  try {
    client = new TelegraphClient({ network: networkFromEnv(), signer: viemSigner(key), maxUusdcPerCall: Math.round(maxUsdcPerCall * 1e6) });
  } catch (e) {
    // Never log the key; the board shows the agent offline.
    console.error(`DESK_PAYER_KEY is not a usable private key: ${(e as Error).name}`);
    return null;
  }
  const pin = process.env.SKEIN_MINER_ID || SKEIN_MINER_ID;
  const minerId = pin === "routed" ? undefined : pin;
  const intent = process.env.DESK_INTENT || DESK_INTENT;
  const timeoutMs = num(process.env.DESK_TELEGRAPH_TIMEOUT_MS, 45_000);
  return (wrap) => new Skein({ apiUrl: SKEIN_API_URL, payer: { kind: "telegraph", client: wrap(client), intent, ...(minerId ? { minerId } : {}) }, maxUsdcPerCall, timeoutMs });
}

export async function deskDeps(overrides: Partial<AgentDeps> = {}): Promise<AgentDeps> {
  const maxUsdcPerCall = num(process.env.DESK_MAX_USDC_PER_CALL, 0.3);
  return {
    store: await defaultStore(),
    skein: partnerFromEnv(maxUsdcPerCall),
    telegraph: telegraphFromEnv(maxUsdcPerCall),
    rail: payerRail(),
    webUrl: SKEIN_WEB_URL,
    telegraphFormDaily: num(process.env.DESK_TELEGRAPH_FORM_DAILY, 1),
    ...overrides,
  };
}

/** Applications the agent files itself a UTC day (see lib/intake.ts). */
export const AUTO_DAILY = num(process.env.DESK_AUTO_DAILY, 1);

/**
 * Applications from the public form per UTC day. Each buys at most one verdict
 * under dex-list (budget 0.13 USDC), so the form can spend at most 20 x 0.13 =
 * 2.6 USDC a day: about a quarter of the API's 10 USDC daily cap, leaving the
 * rest for partners. Webhook intake needs DESK_WEBHOOK_SECRET. On the Telegraph
 * rail only DESK_TELEGRAPH_FORM_DAILY of them a day spend from the escrow.
 */
export const DAILY_LIMIT = Number(process.env.DESK_DAILY_APPLICATIONS ?? 20);
export const PER_IP_DAILY_LIMIT = Number(process.env.DESK_DAILY_PER_IP ?? 5);

/** True on Netlify's runtime (the same test the store uses to pick its backend). */
export const onNetlify = () => "Netlify" in globalThis || !!process.env.NETLIFY_BLOBS_CONTEXT || process.env.NETLIFY === "true";

/** The background function that runs the agent on Netlify (netlify/agent/desk-agent-background.mts, bundled into netlify/functions by `pnpm build:functions`). */
export const BACKGROUND_AGENT_PATH = "/.netlify/functions/desk-agent-background";

/**
 * Asks Netlify to run the agent in its background function now (it answers
 * 202 at once and runs for up to 15 minutes). Best effort: the minute's
 * scheduled run starts it anyway.
 */
export async function kickBackgroundAgent(origin: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const secret = process.env.DESK_CRON_SECRET;
  if (!secret) return false;
  try {
    const r = await fetchImpl(`${origin.replace(/\/$/, "")}${BACKGROUND_AGENT_PATH}`, { method: "POST", headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(4_000) });
    return r.status === 202;
  } catch {
    return false;
  }
}
