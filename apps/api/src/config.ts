import { networkFromEnv, type NetworkConfig } from "@skein/telegraph";

export interface ApiConfig {
  port: number;
  network: NetworkConfig;
  /** What Skein charges per verdict, gross, in micro-USDC (the registration floor). */
  priceUusdc: number;
  dailyCapUusdc: number;
  perVerdictCapUusdc: number;
  spotcheckDailyCapUusdc: number;
  cacheTtlSec: number;
  syncTimeoutMs: number;
  /** Shared secret the Telegraph dispatcher presents on /miner/verdict. */
  minerAuthKey?: string;
  allowPreSeason: boolean;
  defaultPolicy: string;
  /** Origins allowed to call the API from a browser. */
  webOrigins: string[];
  /** Shown instead of the CAIP-2 id, e.g. "simulated" for the local dev stack. */
  networkLabel?: string;
}

const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const usdc = (v: string | undefined, d: number) => Math.round(num(v, d) * 1_000_000);

export function configFromEnv(env: Record<string, string | undefined> = process.env): ApiConfig {
  return {
    port: num(env.PORT, 8080),
    network: networkFromEnv(env),
    priceUusdc: usdc(env.SKEIN_PRICE_USDC, 0.25),
    dailyCapUusdc: usdc(env.DAILY_CAP_USDC, 10),
    perVerdictCapUusdc: usdc(env.PER_VERDICT_CAP_USDC, 0.2),
    spotcheckDailyCapUusdc: usdc(env.SPOTCHECK_DAILY_CAP_USDC, 2),
    cacheTtlSec: num(env.CACHE_TTL_SEC, 600),
    syncTimeoutMs: num(env.SYNC_TIMEOUT_MS, 25_000),
    ...(env.MINER_AUTH_KEY ? { minerAuthKey: env.MINER_AUTH_KEY } : {}),
    allowPreSeason: env.ALLOW_PRE_SEASON === "true",
    defaultPolicy: env.DEFAULT_POLICY || "cex-standard",
    webOrigins: (env.WEB_ORIGINS || "http://localhost:3000").split(",").map((o) => o.trim()).filter(Boolean),
    ...(env.NETWORK_LABEL ? { networkLabel: env.NETWORK_LABEL } : {}),
  };
}
