// Skein Sniper: the Mission 14 agent. Environment:
//   SNIPER_SKEIN_KEY       a Skein partner key (apiKey rail), or
//   SNIPER_PAYER_KEY       a funded Telegraph burner: each verdict is one paid Telegraph ask
//   SNIPER_MINER_ID        with SNIPER_PAYER_KEY: pin Skein's miner (default 845301, its catalogue id)
//   SNIPER_INTENT          with SNIPER_PAYER_KEY: the intent Skein serves (default FRAUD_RISK_GENERAL)
//   SKEIN_API_URL          default https://api.skeinlabs.site
//   SKEIN_WEB_URL          default https://skeinlabs.site (links)
//   SKEIN_ATTESTER         Skein's signer address. Pin it. Unset: read from /v1/status
//                          (with retries); the sniper does not start without one
//   DATABASE_URL           Postgres (a table of its own); memory when unset
//   BASE_RPC_URL           default https://base-rpc.publicnode.com
//   SNIPER_POLICY, SNIPER_MIN_LIQUIDITY_USD, SNIPER_MIN_AGE_MIN, SNIPER_MAX_AGE_MIN,
//   SNIPER_DAILY_CHECKS, SNIPER_DAILY_USDC, SNIPER_MAX_USDC_PER_CALL, SNIPER_TICKET_USD,
//   SNIPER_TICK_SEC   (see agent.ts DEFAULTS; a value that is not a number stops the sniper)
//   PORT                   default 8080
import { serve } from "@hono/node-server";
import { Skein, type Payer, type VerdictResult } from "@skeinlabs/sdk";
import { Sniper, DEFAULTS, liquidityFloor, type SniperConfig } from "./agent";
import { dexScreener } from "./market";
import { createServer } from "./server";
import { memoryStore, pgStore } from "./store";
import { rpcChain, Watcher } from "./watch";
import { createReporter } from "@skein/errors";

const env = process.env;
const fail = (msg: string): never => {
  console.error(`[sniper] refusing to start: ${msg}`);
  process.exit(1);
};
/** A number from the environment, or the default; anything else stops the sniper (a typo must not lift a cap). */
const num = (k: string, d: number, min = 0) => {
  const raw = env[k];
  if (raw === undefined || raw.trim() === "") return d;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < min) fail(`${k} must be a number of at least ${min} (got ${JSON.stringify(raw)})`);
  return v;
};
const config: SniperConfig = {
  ...DEFAULTS,
  policy: env.SNIPER_POLICY || DEFAULTS.policy,
  minLiquidityUsd: num("SNIPER_MIN_LIQUIDITY_USD", DEFAULTS.minLiquidityUsd),
  minAgeMin: num("SNIPER_MIN_AGE_MIN", DEFAULTS.minAgeMin),
  maxAgeMin: num("SNIPER_MAX_AGE_MIN", DEFAULTS.maxAgeMin),
  dailyChecks: num("SNIPER_DAILY_CHECKS", DEFAULTS.dailyChecks),
  dailyUsdc: num("SNIPER_DAILY_USDC", DEFAULTS.dailyUsdc),
  maxUsdcPerCall: num("SNIPER_MAX_USDC_PER_CALL", DEFAULTS.maxUsdcPerCall, 0.000001),
  ticketUsd: num("SNIPER_TICKET_USD", DEFAULTS.ticketUsd),
};
const apiUrl = (env.SKEIN_API_URL ?? "https://api.skeinlabs.site").replace(/\/$/, "");
const skeinWeb = env.SKEIN_WEB_URL ?? "https://skeinlabs.site";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function payer(): Promise<Payer> {
  if (env.SNIPER_PAYER_KEY) {
    const { TelegraphClient, networkFromEnv, viemSigner } = await import("@skeinlabs/sdk/telegraph");
    const client = new TelegraphClient({ network: networkFromEnv(env), signer: viemSigner(env.SNIPER_PAYER_KEY as `0x${string}`), maxUusdcPerCall: Math.round(config.maxUsdcPerCall * 1e6) });
    // Pinned to Skein's miner: on a routed ask any miner on the intent could answer.
    return { kind: "telegraph", client, intent: env.SNIPER_INTENT || "FRAUD_RISK_GENERAL", minerId: env.SNIPER_MINER_ID || "845301" };
  }
  if (env.SNIPER_SKEIN_KEY) return { kind: "apiKey", key: env.SNIPER_SKEIN_KEY };
  return fail("set SNIPER_SKEIN_KEY (a Skein partner key) or SNIPER_PAYER_KEY (a funded Telegraph burner)");
}

/** Skein's attester: pinned, or read from /v1/status with retries. Never silently none. */
async function attester(): Promise<string> {
  const pinned = env.SKEIN_ATTESTER?.trim();
  if (pinned) return /^0x[0-9a-fA-F]{40}$/.test(pinned) ? pinned : fail(`SKEIN_ATTESTER is not an address: ${pinned}`);
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const s = (await (await fetch(`${apiUrl}/v1/status`, { signal: AbortSignal.timeout(10_000) })).json()) as { attester?: string | null };
      if (s.attester && /^0x[0-9a-fA-F]{40}$/.test(s.attester)) {
        console.log(`[sniper] attester ${s.attester} read from ${apiUrl}/v1/status; pin it with SKEIN_ATTESTER`);
        return s.attester;
      }
      return fail(`${apiUrl}/v1/status names no attester (the API signs nothing); set SKEIN_ATTESTER`);
    } catch (e) {
      console.error(`[sniper] reading the attester (attempt ${attempt}/5): ${(e as Error).message}`);
      await sleep(2_000 * attempt);
    }
  }
  return fail(`could not read the attester from ${apiUrl}/v1/status; set SKEIN_ATTESTER`);
}

const p = await payer();
const skein = new Skein({ apiUrl, payer: p, maxUsdcPerCall: config.maxUsdcPerCall, timeoutMs: 100_000 });
const signer = await attester();
const { verifyAttestation } = await import("@skeinlabs/sdk/attest");
const verify = async (v: VerdictResult) => (v.attestation ? (await verifyAttestation(v, { signer })).ok : false);

// The liquidity floor: never below the policy's liquidity_depth FAIL threshold.
let policy: unknown = null;
for (let attempt = 1; attempt <= 3 && policy === null; attempt++) {
  policy = await fetch(`${apiUrl}/v1/policies/${encodeURIComponent(config.policy)}`, { signal: AbortSignal.timeout(10_000) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .catch((e: Error) => (console.error(`[sniper] reading ${config.policy} (attempt ${attempt}/3): ${e.message}`), null));
  if (policy === null) await sleep(2_000 * attempt);
}
const floor = liquidityFloor(policy, config.minLiquidityUsd);
if (floor.floor !== config.minLiquidityUsd) console.log(`[sniper] minimum liquidity raised from $${config.minLiquidityUsd} to $${floor.floor}: ${floor.source}`);
config.minLiquidityUsd = floor.floor;

const store = env.DATABASE_URL ? await pgStore(env.DATABASE_URL) : memoryStore();
// A check interrupted by a restart is recovered by the agent once it is stale (agent.ts recoverStale):
// requeued on the partner-key rail, never re-asked (and counted as paid) on the Telegraph rail.

const watcher = new Watcher(rpcChain(env.BASE_RPC_URL || "https://base-rpc.publicnode.com"));
const sniper = new Sniper({ store, market: dexScreener(), skein, rail: p.kind === "telegraph" ? "telegraph" : "apiKey", watch: () => watcher.poll(), verify, config, log: (m) => console.log(`[sniper] ${m}`) });

const app = createServer(store, config, { rail: p.kind, attester: signer, skeinWeb });
const port = num("PORT", 8080);
serve({ fetch: app.fetch, port });
console.log(`skein sniper on :${port} · ${p.kind} rail · policy ${config.policy} · min liquidity $${config.minLiquidityUsd} · ${config.dailyChecks} checks / ${config.dailyUsdc} USDC a day · attester ${signer} · store ${env.DATABASE_URL ? "postgres" : "memory"}`);

// Error tracking: SENTRY_DSN (Sentry or compatible); off when unset.
const errors = createReporter({ dsn: env.SENTRY_DSN, service: "skein-sniper", release: env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) });
process.on("unhandledRejection", (reason) => void errors.capture(reason, { kind: "unhandledRejection" }));

const every = num("SNIPER_TICK_SEC", 30, 1) * 1000;
let current: Promise<void> | null = null;
let stopping = false;
const loop = async () => {
  if (stopping) return;
  current = sniper.tick().catch((e) => {
    console.error(`[sniper] tick: ${(e as Error).message}`);
    void errors.capture(e, { kind: "tick" });
  });
  await current;
  current = null;
  if (!stopping) setTimeout(loop, every).unref?.();
};
void loop();

// Railway sends SIGTERM on every redeploy: stop starting ticks, and let a
// verdict in flight store its result. 30 s at most; a check cut off here stays
// "checking" and is recovered without a second payment (see above).
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`[sniper] ${signal}: ${current ? "finishing the current tick" : "idle"}, then exiting`);
  if (current) await Promise.race([current, new Promise((r) => setTimeout(r, 30_000))]);
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
