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
  /** Signs every verdict (EIP-191); its address is published at /v1/status. Not a wallet: it holds nothing. */
  attestationKey?: `0x${string}`;
  allowPreSeason: boolean;
  defaultPolicy: string;
  /** Origins allowed to call the API from a browser. */
  webOrigins: string[];
  /** Shown instead of the CAIP-2 id, e.g. "simulated" for the local dev stack. */
  networkLabel?: string;
  /** Hard ceiling one upstream payment may never exceed, whatever a 402 asks. */
  maxUusdcPerCall: number;
  /** One deadline for a whole verdict run. */
  verdictDeadlineMs: number;
  /** /miner/verdict answers within this, with ABSTAIN if the verdict is not sealed yet. */
  minerDeadlineMs: number;
  /** A cache hit older than this refreshes in the background (docs/DECISIONS.md, D5). */
  cacheRefreshMinAgeSec: number;
  /** /v1/status raises an alert below this purchaser wallet balance. */
  hotWalletAlertUusdc: number;
  /** Proxies in front of the API that append to X-Forwarded-For (Railway's edge: 1). */
  trustProxyHops: number;
  /** SHA-256 hashes of partner keys to refuse, without database access. */
  revokedKeyHashes: string[];
  /** SHA-256 hashes of the partner keys that may use /v1/kv (first-party apps such as Skein Desk). */
  kvKeyHashes: string[];
  /** Where rate-limit buckets live: postgres (shared by every replica, the default) or memory (one process). */
  rateLimitStore: "postgres" | "memory";
  /** SSE event rows older than this are pruned (they are not evidence). */
  eventRetentionDays: number;
  /** Skein's own miner registration ids, never bought from. */
  selfRegistrationIds: string[];
}

const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const usdc = (v: string | undefined, d: number) => Math.round(num(v, d) * 1_000_000);

function attestationKey(raw: string): `0x${string}` {
  const k = raw.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error("SKEIN_ATTESTATION_KEY must be a 0x-prefixed 32-byte hex private key");
  return k as `0x${string}`;
}

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
    ...(env.SKEIN_ATTESTATION_KEY ? { attestationKey: attestationKey(env.SKEIN_ATTESTATION_KEY) } : {}),
    allowPreSeason: env.ALLOW_PRE_SEASON === "true",
    // dex-list is plannable on today's intents; cex-standard waits for a holder-concentration miner.
    defaultPolicy: env.DEFAULT_POLICY || "dex-list",
    webOrigins: (env.WEB_ORIGINS || "http://localhost:3000").split(",").map((o) => o.trim()).filter(Boolean),
    ...(env.NETWORK_LABEL ? { networkLabel: env.NETWORK_LABEL } : {}),
    maxUusdcPerCall: usdc(env.MAX_USDC_PER_CALL, 0.05),
    verdictDeadlineMs: num(env.VERDICT_DEADLINE_MS, 90_000),
    minerDeadlineMs: num(env.MINER_DEADLINE_MS, 25_000),
    cacheRefreshMinAgeSec: num(env.CACHE_REFRESH_MIN_AGE_SEC, 480),
    hotWalletAlertUusdc: usdc(env.HOT_WALLET_ALERT_USDC, 2),
    trustProxyHops: num(env.TRUST_PROXY_HOPS, 1),
    rateLimitStore: env.RATE_LIMIT_STORE === "memory" ? "memory" : "postgres",
    kvKeyHashes: (env.KV_KEY_HASHES ?? "").split(",").map((h) => h.trim().toLowerCase()).filter((h) => /^[0-9a-f]{64}$/.test(h)),
    revokedKeyHashes: (env.REVOKED_KEY_HASHES ?? "").split(",").map((h) => h.trim().toLowerCase()).filter((h) => /^[0-9a-f]{64}$/.test(h)),
    eventRetentionDays: num(env.EVENT_RETENTION_DAYS, 7),
    selfRegistrationIds: (env.SKEIN_SELF_REGISTRATION_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}
