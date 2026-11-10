// Skein probe: one run per Railway cron tick (every 10 minutes), then exit.
// Checks every public service, the purchaser escrow, the spend cap, unhandled
// errors, the Telegraph miner and the nightly backup, and pushes alerts to
// ALERT_WEBHOOK_URL (ntfy, Slack or Discord). docs/RUNBOOK.md, "Alerts".
import { Alerter } from "@skein/alerts";
import pg from "pg";
import { runOnce } from "./run";

const url = process.env.DATABASE_URL;
const pool = url ? new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000, statement_timeout: 10_000 }) : undefined;
pool?.on("error", (e) => console.error(JSON.stringify({ level: "error", msg: "postgres pool error", error: e.message })));

const alerter = new Alerter({ url: process.env.ALERT_WEBHOOK_URL, service: "skein-probe", repeatMs: 3 * 3_600_000, ...(pool ? { db: pool } : {}) });
if (!alerter.configured) console.warn(JSON.stringify({ level: "warn", msg: "ALERT_WEBHOOK_URL is not set: alerts go to the log only" }));

const started = Date.now();
try {
  const report = await runOnce({ ctx: { fetch, now: Date.now, ...(pool ? { db: pool } : {}) }, alerter, ...(pool ? { db: pool } : {}) });
  console.log(JSON.stringify({ level: report.failing.length ? "warn" : "info", msg: "probe run", ms: Date.now() - started, ok: report.ok, failing: report.failing }));
} catch (e) {
  console.error(JSON.stringify({ level: "error", msg: "probe run failed", error: (e as Error).message }));
  process.exitCode = 1;
} finally {
  await pool?.end().catch(() => {});
}
