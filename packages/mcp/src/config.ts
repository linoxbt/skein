import { SKEIN_INTENT, SKEIN_MINER_ID } from "@skeinlabs/sdk";

/** A setting the server cannot start with; the message says which and why. */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

export interface McpConfig {
  apiUrl: string;
  webUrl: string;
  maxUsdcPerCall: number;
  sessionCapUsdc: number;
  /** "list": a partner-key verdict counts at Skein's list price against the session cap; "free": it counts 0. */
  apiKeyBilling: "list" | "free";
  /** The Telegraph rail's intent and pinned miner (SKEIN_PAYER_KEY only). */
  intent: string;
  minerId: string;
  warnings: string[];
}

/** A USDC amount from the environment: a finite number above 0, or the default when unset. */
function usdc(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = Number(raw.trim());
  if (!Number.isFinite(v) || v <= 0) throw new ConfigError(`${name} must be a positive number of USDC, like 0.3 (got ${JSON.stringify(raw)})`);
  return v;
}

/**
 * The server's settings, checked: a cap that is not a finite positive number
 * stops the server rather than turning the cap off (Number("2usdc") is NaN,
 * and every comparison with NaN is false).
 */
export function mcpConfigFromEnv(env: Record<string, string | undefined>): McpConfig {
  const warnings: string[] = [];
  const maxUsdcPerCall = usdc(env, "SKEIN_MAX_USDC_PER_CALL", 0.3);
  let sessionCapUsdc = usdc(env, "SKEIN_SESSION_CAP_USDC", 2);
  if (env.SKEIN_DAILY_CAP_USDC !== undefined && env.SKEIN_DAILY_CAP_USDC.trim() !== "") {
    // The old name. The cap was always per server process, never per day.
    const alias = usdc(env, "SKEIN_DAILY_CAP_USDC", 2);
    if (env.SKEIN_SESSION_CAP_USDC === undefined || env.SKEIN_SESSION_CAP_USDC.trim() === "") sessionCapUsdc = alias;
    warnings.push("SKEIN_DAILY_CAP_USDC is a deprecated alias of SKEIN_SESSION_CAP_USDC: the cap is per server process, not per day");
  }
  if (maxUsdcPerCall > sessionCapUsdc) warnings.push(`SKEIN_MAX_USDC_PER_CALL (${maxUsdcPerCall}) is above the session cap (${sessionCapUsdc}): the Telegraph rail reserves the per-call cap, so it can buy nothing`);
  const billing = (env.SKEIN_API_KEY_BILLING ?? "list").trim().toLowerCase() || "list";
  if (billing !== "list" && billing !== "free") throw new ConfigError(`SKEIN_API_KEY_BILLING must be list or free (got ${JSON.stringify(env.SKEIN_API_KEY_BILLING)})`);
  const minerId = (env.SKEIN_MINER_ID ?? "").trim() || SKEIN_MINER_ID;
  if (!/^\d+$/.test(minerId)) throw new ConfigError(`SKEIN_MINER_ID must be a numeric Telegraph miner id (got ${JSON.stringify(env.SKEIN_MINER_ID)})`);
  const intent = (env.SKEIN_INTENT ?? "").trim() || SKEIN_INTENT;
  if (!/^[A-Z][A-Z0-9_]*$/.test(intent)) throw new ConfigError(`SKEIN_INTENT must be a Telegraph intent name like ${SKEIN_INTENT} (got ${JSON.stringify(env.SKEIN_INTENT)})`);
  return {
    apiUrl: env.SKEIN_API_URL?.trim() || "https://api.skeinlabs.site",
    webUrl: env.SKEIN_WEB_URL?.trim() || "https://skeinlabs.site",
    maxUsdcPerCall,
    sessionCapUsdc,
    apiKeyBilling: billing,
    intent,
    minerId,
    warnings,
  };
}
