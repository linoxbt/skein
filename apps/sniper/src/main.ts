// Skein Sniper: the Mission 14 agent. Environment:
//   SNIPER_SKEIN_KEY       a Skein partner key (apiKey rail), or
//   SNIPER_PAYER_KEY       a funded Telegraph burner: each verdict is one paid Telegraph ask
//   SNIPER_MINER_ID        with SNIPER_PAYER_KEY: pin Skein's miner (its registration id)
//   SNIPER_INTENT          with SNIPER_PAYER_KEY: the intent Skein serves (default FRAUD_RISK_GENERAL)
//   SKEIN_API_URL          default https://api.skeinlabs.site
//   SKEIN_WEB_URL          default https://skeinlabs.site (links)
//   SKEIN_ATTESTER         Skein's signer address; default: read once from /v1/status
//   DATABASE_URL           Postgres (a table of its own); memory when unset
//   BASE_RPC_URL           default https://base-rpc.publicnode.com
//   SNIPER_POLICY, SNIPER_MIN_LIQUIDITY_USD, SNIPER_MIN_AGE_MIN, SNIPER_MAX_AGE_MIN,
//   SNIPER_DAILY_CHECKS, SNIPER_TICKET_USD, SNIPER_TICK_SEC   (see agent.ts DEFAULTS)
//   PORT                   default 8080
import { serve } from "@hono/node-server";
import { Skein, type Payer, type VerdictResult } from "@skeinlabs/sdk";
import { Sniper, DEFAULTS, type SniperConfig } from "./agent";
import { dexScreener } from "./market";
import { createServer } from "./server";
import { memoryStore, pgStore } from "./store";
import { rpcChain, Watcher } from "./watch";

const env = process.env;
const num = (k: string, d: number) => (env[k] !== undefined && env[k] !== "" && Number.isFinite(Number(env[k])) ? Number(env[k]) : d);
const config: SniperConfig = {
  ...DEFAULTS,
  policy: env.SNIPER_POLICY || DEFAULTS.policy,
  minLiquidityUsd: num("SNIPER_MIN_LIQUIDITY_USD", DEFAULTS.minLiquidityUsd),
  minAgeMin: num("SNIPER_MIN_AGE_MIN", DEFAULTS.minAgeMin),
  maxAgeMin: num("SNIPER_MAX_AGE_MIN", DEFAULTS.maxAgeMin),
  dailyChecks: num("SNIPER_DAILY_CHECKS", DEFAULTS.dailyChecks),
  ticketUsd: num("SNIPER_TICKET_USD", DEFAULTS.ticketUsd),
};
const apiUrl = env.SKEIN_API_URL ?? "https://api.skeinlabs.site";
const skeinWeb = env.SKEIN_WEB_URL ?? "https://skeinlabs.site";
const maxUsdcPerCall = num("SNIPER_MAX_USDC_PER_CALL", 0.3);

async function payer(): Promise<Payer> {
  if (env.SNIPER_PAYER_KEY) {
    const { TelegraphClient, networkFromEnv, viemSigner } = await import("@skeinlabs/sdk/telegraph");
    const client = new TelegraphClient({ network: networkFromEnv(env), signer: viemSigner(env.SNIPER_PAYER_KEY as `0x${string}`), maxUusdcPerCall: Math.round(maxUsdcPerCall * 1e6) });
    return { kind: "telegraph", client, intent: env.SNIPER_INTENT || "FRAUD_RISK_GENERAL", ...(env.SNIPER_MINER_ID ? { minerId: env.SNIPER_MINER_ID } : {}) };
  }
  if (env.SNIPER_SKEIN_KEY) return { kind: "apiKey", key: env.SNIPER_SKEIN_KEY };
  throw new Error("set SNIPER_SKEIN_KEY (a Skein partner key) or SNIPER_PAYER_KEY (a funded Telegraph burner)");
}

const p = await payer();
const skein = new Skein({ apiUrl, payer: p, maxUsdcPerCall, timeoutMs: 100_000 });
const store = env.DATABASE_URL ? await pgStore(env.DATABASE_URL) : memoryStore();
// A token left mid-check by a restart goes back to watching; its idempotency key stops a second charge.
for (const r of await store.byStatus("checking", 100)) await store.save({ ...r, status: "watching" });

const attester =
  env.SKEIN_ATTESTER ||
  ((await fetch(`${apiUrl}/v1/status`).then((r) => r.json()).catch(() => ({}))) as { attester?: string | null }).attester ||
  null;
let verify: ((v: VerdictResult) => Promise<boolean | null>) | undefined;
if (attester) {
  const { verifyAttestation } = await import("@skeinlabs/sdk/attest");
  verify = async (v) => (v.attestation ? (await verifyAttestation(v, { signer: attester })).ok : false);
}

const watcher = new Watcher(rpcChain(env.BASE_RPC_URL || "https://base-rpc.publicnode.com"));
const sniper = new Sniper({ store, market: dexScreener(), skein, watch: () => watcher.poll(), ...(verify ? { verify } : {}), config, log: (m) => console.log(`[sniper] ${m}`) });

const app = createServer(store, config, { rail: p.kind, attester, skeinWeb });
const port = num("PORT", 8080);
serve({ fetch: app.fetch, port });
console.log(`skein sniper on :${port} · ${p.kind} rail · policy ${config.policy} · min liquidity $${config.minLiquidityUsd} · attester ${attester ?? "none"} · store ${env.DATABASE_URL ? "postgres" : "memory"}`);

const every = num("SNIPER_TICK_SEC", 30) * 1000;
const loop = async () => {
  await sniper.tick().catch((e) => console.error(`[sniper] tick: ${(e as Error).message}`));
  setTimeout(loop, every).unref?.();
};
void loop();
// Keep the process alive for the server; the loop timer is unref'd so a SIGTERM can end it.
process.on("SIGTERM", () => process.exit(0));
