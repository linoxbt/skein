import { serve } from "@hono/node-server";
import { dexScreenerResolver } from "@skein/pipeline";
import { TelegraphClient, viemSigner } from "@skein/telegraph";
import { createPublicClient, erc20Abi, http } from "viem";
import { createApp, walletState } from "./app";
import { configFromEnv } from "./config";
import { connect, runMigrations } from "./db";
import { parseSeedConsumers, revokeKeys, seedConsumers } from "./seed";
import { VerdictService } from "./service";
import { Alerts } from "./alerts";

const config = configFromEnv();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const { db, pool } = connect(url);
await runMigrations(pool);
const seeded = await seedConsumers(db, parseSeedConsumers(process.env.SEED_CONSUMERS));
const revoked = await revokeKeys(db, config.revokedKeyHashes);
if (seeded.added.length || seeded.updated.length || seeded.revoked || revoked) {
  console.log(`consumers: added ${seeded.added.join(", ") || "none"}; updated ${seeded.updated.join(", ") || "none"}; revoked ${seeded.revoked + revoked}`);
}

const key = process.env.PURCHASER_PRIVATE_KEY as `0x${string}` | undefined;
const signer = key ? viemSigner(key) : undefined;
const client = new TelegraphClient({
  network: config.network,
  maxUusdcPerCall: config.maxUusdcPerCall,
  allowPreSeason: config.allowPreSeason,
  ...(signer ? { signer } : {}),
});
// Wallet low, spend cap near, verdicts lost, unhandled errors: pushed to ALERT_WEBHOOK_URL (Slack or Discord) when set.
const alerts = new Alerts({ url: process.env.ALERT_WEBHOOK_URL || undefined, service: "skein-api" });

const service = new VerdictService({
  alerts,
  db,
  config,
  client,
  resolver: dexScreenerResolver(),
  ...(signer ? { payerAddress: signer.address } : {}),
});

const every = (ms: number, task: () => Promise<unknown>, name: string) => {
  const run = () => void task().catch((e: Error) => console.error(`${name} failed:`, e.message));
  run();
  return setInterval(run, ms);
};


// The purchaser wallet's test-USDC balance, for the /v1/status alert.
const chain = createPublicClient({ transport: http(config.network.rpcUrl) });
const timers = [
  every(5 * 60_000, () => service.refreshCatalogue(), "catalogue refresh"),
  every(60_000, async () => {
    const n = await service.sweep();
    if (n) {
      console.warn(`marked ${n} run(s) lost (stopped before finishing)`);
      await alerts.raise("lost-runs", `${n} verdict run(s) stopped before finishing and were marked lost`);
    }
  }, "lost-run sweep"),
  // Spec: stop-and-alert at 80% of the day's cap (verdicts stop at 100%).
  every(5 * 60_000, async () => {
    const spent = await service.spentTodayUusdc();
    if (spent >= 0.8 * config.dailyCapUusdc) await alerts.raise("cap", `upstream spend today is ${spent / 1e6} USDC, at or over 80% of the ${config.dailyCapUusdc / 1e6} USDC daily cap`);
    else alerts.clear("cap");
  }, "spend cap"),
  every(60 * 60_000, () => service.pruneEvents(), "event pruning"),
  ...(signer
    ? [every(5 * 60_000, async () => {
        const b = await chain.readContract({ address: config.network.usdc as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [signer.address as `0x${string}`] });
        walletState.set(Number(b));
        if (Number(b) < config.hotWalletAlertUusdc) {
          await alerts.raise("wallet", `the purchaser wallet holds ${Number(b) / 1e6} test USDC, below ${config.hotWalletAlertUusdc / 1e6}: refill it (docs/RUNBOOK.md)`);
        } else alerts.clear("wallet");
      }, "wallet balance")]
    : []),
];

const server = serve({ fetch: createApp(service).fetch, port: config.port });
console.log(
  `skein api on :${config.port} · ${config.network.caip2} · payer ${signer?.address ?? "none (paid calls disabled)"} · ` +
    `catalogue ${Object.values(service.catalogue.minersByIntent).flat().length} miners`,
);

// Railway sends SIGTERM on every redeploy. Stop taking work, let running
// verdicts store their result (their purchases are already written), then close.
let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: draining ${service.running.size} running verdict(s)`);
  for (const t of timers) clearInterval(t);
  server.close();
  await service.drain(45_000);
  await pool.end().catch(() => {});
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
