import { networkFromEnv, type NetworkConfig } from "@skein/telegraph";
import { secretKeyFromEnv } from "./webhooks";
import { x402FromEnv, type X402Config } from "./x402";

export interface ApiConfig {
  port: number;
  network: NetworkConfig;
  /** What Skein charges per verdict, gross, in micro-USDC (the registration floor). */
  priceUusdc: number;
  dailyCapUusdc: number;
  /**
   * Where verdicts stop buying: GLOBAL_CAP_STOP_PCT (default 80, spec §8:
   * "the purchaser stops and alerts at 80%") of the daily cap. The spend gate
   * and the early refusal both use this; dailyCapUusdc stays the published cap.
   */
  stopAtUusdc: number;
  /** Below this escrow balance, uncached verdicts pause (503 WALLET_EMPTY) instead of failing purchase by purchase. */
  walletPauseUusdc: number;
  /** JSON-RPC endpoints per chain id for the "not a contract" subject check; a chain without one is not checked. */
  subjectRpcUrls: Record<number, string>;
  /** AES-256-GCM key for webhook secrets at rest (webhooks.ts); unset stores them in plain text. */
  webhookSecretKey?: Buffer;
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
  /** Pay-per-verdict on POST /v1/verdicts without a partner key; off unless X402_PAY_TO is set. */
  x402?: X402Config;
}

const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const usdc = (v: string | undefined, d: number) => Math.round(num(v, d) * 1_000_000);

function attestationKey(raw: string): `0x${string}` {
  const k = raw.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error("SKEIN_ATTESTATION_KEY must be a 0x-prefixed 32-byte hex private key");
  return k as `0x${string}`;
}

/** "8453=https://…,56=https://…" */
function rpcUrls(raw: string | undefined): Record<number, string> {
  const out: Record<number, string> = {};
  for (const entry of (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const at = entry.indexOf("=");
    const chain = Number(entry.slice(0, at));
    const url = entry.slice(at + 1).trim();
    if (at < 1 || !Number.isInteger(chain) || !/^https:\/\//.test(url)) throw new Error(`SUBJECT_RPC_URLS: bad entry "${entry.slice(0, 40)}" (want chainId=https://…)`);
    out[chain] = url;
  }
  return out;
}

/** True where the deployment is production (Railway's production environment, or NODE_ENV=production). */
export const isProduction = (env: Record<string, string | undefined>) => env.RAILWAY_ENVIRONMENT_NAME === "production" || env.NODE_ENV === "production";

/**
 * Settings a production API must not start without; empty when it may start.
 * Checked by server.ts at boot (fail closed), never by tests or the dev stack.
 */
export function productionProblems(env: Record<string, string | undefined>, config: ApiConfig): string[] {
  if (!isProduction(env)) return [];
  const out: string[] = [];
  // Spec §9: Skein never buys from itself. A receipt names a miner by registration id, so both ids are needed.
  if (config.selfRegistrationIds.length === 0) out.push("SKEIN_SELF_REGISTRATION_IDS is empty: set Skein's own miner ids (catalogue id and registration id) so it can never buy from itself");
  return out;
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): ApiConfig {
  const dailyCapUusdc = usdc(env.DAILY_CAP_USDC, 10);
  const stopPct = num(env.GLOBAL_CAP_STOP_PCT, 80);
  if (stopPct <= 0 || stopPct > 100) throw new Error("GLOBAL_CAP_STOP_PCT must be in (0, 100]");
  const perVerdictCapUusdc = usdc(env.PER_VERDICT_CAP_USDC, 0.2);
  return {
    port: num(env.PORT, 8080),
    network: networkFromEnv(env),
    priceUusdc: usdc(env.SKEIN_PRICE_USDC, 0.25),
    dailyCapUusdc,
    stopAtUusdc: Math.round((dailyCapUusdc * stopPct) / 100),
    walletPauseUusdc: usdc(env.HOT_WALLET_PAUSE_USDC, 0.05),
    subjectRpcUrls: rpcUrls(env.SUBJECT_RPC_URLS),
    ...(() => {
      const k = secretKeyFromEnv(env.WEBHOOK_SECRET_KEY);
      return k ? { webhookSecretKey: k } : {};
    })(),
    perVerdictCapUusdc,
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
    ...(() => {
      const x = x402FromEnv(env);
      return x ? { x402: x } : {};
    })(),
  };
}
