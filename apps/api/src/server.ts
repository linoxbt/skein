import { serve } from "@hono/node-server";
import { dexScreenerResolver } from "@skein/pipeline";
import { TelegraphClient, viemSigner } from "@skein/telegraph";
import { createPublicClient, erc20Abi, http, parseAbi } from "viem";
import { createApp, walletState } from "./app";
import { configFromEnv } from "./config";
import { connectForRuntime } from "./db";
import { parseSeedConsumers, revokeKeys, seedConsumers } from "./seed";
import { VerdictService } from "./service";
import { createReporter } from "@skein/errors";
import { Alerts } from "./alerts";
import { pruneShared } from "./limits";

const config = configFromEnv();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const { db, pool, role: dbRole } = await connectForRuntime(url);
console.log(JSON.stringify({ level: "info", msg: "database connected", role: dbRole }));
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
// Wallet low, spend cap near, verdicts lost, unhandled errors: pushed to ALERT_WEBHOOK_URL (ntfy, Slack or
// Discord), with the alert state in Postgres so two replicas send one message, and a recovery when it clears.
const alerts = new Alerts({ url: process.env.ALERT_WEBHOOK_URL || undefined, service: "skein-api", repeatMs: 3 * 3_600_000, db: pool });

// Error tracking: SENTRY_DSN (Sentry or any Sentry-compatible service); off when unset.
const errors = createReporter({ dsn: process.env.SENTRY_DSN, service: "skein-api", environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? "production", release: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) });
process.on("unhandledRejection", (reason) => {
  console.error(JSON.stringify({ level: "error", msg: "unhandled rejection", error: String(reason) }));
  void errors.capture(reason, { kind: "unhandledRejection" });
});
process.on("uncaughtExceptionMonitor", (err) => void errors.capture(err, { kind: "uncaughtException" }));

const service = new VerdictService({
  dbRole,
  alerts,
  errors,
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


// The purchaser's escrow and wallet balances, for the /v1/status alert.
const ESCROW_ABI = parseAbi(["function effectiveBalance(address account) view returns (int256)"]);
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
    else await alerts.clear("cap", "upstream spend is back under 80% of the daily cap");
  }, "spend cap"),
  every(60 * 60_000, () => service.pruneEvents(), "event pruning"),
  // Idle rate-limit buckets and expired flight leases (limits.ts).
  every(60 * 60_000, () => pruneShared(db), "shared-state pruning"),
  ...(signer
    ? [every(5 * 60_000, async () => {
        const who = signer.address as `0x${string}`;
        const [b, e] = await Promise.all([
          chain.readContract({ address: config.network.usdc as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [who] }),
          // What purchases spend: the escrow's effective balance (deposits less debt), not the wallet.
          chain.readContract({ address: config.network.diamond as `0x${string}`, abi: ESCROW_ABI, functionName: "effectiveBalance", args: [who] }),
        ]);
        walletState.set(Number(b));
        walletState.setEscrow(Number(e));
        if (Number(e) < config.hotWalletAlertUusdc) {
          await alerts.raise("wallet", `the purchaser's Telegraph escrow holds ${Number(e) / 1e6} test USDC (wallet ${Number(b) / 1e6}), below ${config.hotWalletAlertUusdc / 1e6}: deposit more (docs/RUNBOOK.md)`);
        } else await alerts.clear("wallet", "the purchaser's escrow is back above the alert level");
      }, "wallet balance")]
    : []),
];

const server = serve({ fetch: createApp(service).fetch, port: config.port });
console.log(
  `skein api on :${config.port} · ${config.network.caip2} · payer ${signer?.address ?? "none (paid calls disabled)"} · ` +
    `catalogue ${Object.values(service.catalogue.minersByIntent).flat().length} miners`,
);

// Railway sends SIGTERM on every redeploy. Stop taking connections, let every
// running verdict finish (up to its own deadline) and every open request send
// its answer (a paid one settles after its verdict), then close the pool.
// Railway's draining window (infra/railway.json, drainingSeconds) is longer
// than this, so the process is never killed mid-settlement.
const SHUTDOWN_GRACE_MS = config.verdictDeadlineMs + 20_000;
let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: draining ${service.running.size} running verdict(s), up to ${SHUTDOWN_GRACE_MS / 1000} s`);
  for (const t of timers) clearInterval(t);
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  // Keep-alive sockets with no request in flight would hold close() open.
  (server as unknown as { closeIdleConnections?: () => void }).closeIdleConnections?.();
  const deadline = Date.now() + SHUTDOWN_GRACE_MS;
  await service.drain(SHUTDOWN_GRACE_MS);
  const idle = setInterval(() => (server as unknown as { closeIdleConnections?: () => void }).closeIdleConnections?.(), 500);
  await Promise.race([closed, new Promise((r) => setTimeout(r, Math.max(0, deadline - Date.now())))]);
  clearInterval(idle);
  await pool.end().catch(() => {});
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
