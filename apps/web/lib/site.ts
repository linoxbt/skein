/** The public site's own address, for canonical URLs, the sitemap and social cards. */
export const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://skeinlabs.site").replace(/\/$/, "");

/**
 * Skein's own registration as a Telegraph miner (miner/skein-miner.plan-b.yaml).
 * The browser reads its live state from the node's public registry (CORS
 * open), which next.config.ts allows in connect-src.
 */
export const MINER = {
  registrationId: 5137,
  /** The YAML id: what an ask pins (/engine/v1/ask/845301). */
  minerId: "845301",
  slug: "skein-listing-verdict",
  intent: "FRAUD_RISK_GENERAL",
  node: "https://devnode.telegraphprotocol.com",
} as const;

/** The node's record of a registration (GET /api/miners/{registration id}). */
export interface MinerRegistration {
  registration_id: number;
  slug: string;
  miner_address: string;
  activation_status: string;
  supported_intents: string[];
  min_price_usdc: number;
  rejection_reason: string | null;
  registered_at: string;
  updated_at?: string;
  yaml_url?: string;
  yaml_hash?: string;
}

export async function getRegistration(): Promise<MinerRegistration> {
  const r = await fetch(`${MINER.node}/api/miners/${MINER.registrationId}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!r.ok) throw new Error(`the node answered ${r.status}`);
  const body = (await r.json()) as { miner?: MinerRegistration } & Partial<MinerRegistration>;
  const m = body.miner ?? (body as MinerRegistration);
  if (typeof m.registration_id !== "number") throw new Error("the node's answer has no registration");
  return m;
}
