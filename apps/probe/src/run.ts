import { Alerter, beat, type Queryable } from "@skein/alerts";
import { CHECKS, confirm, resetStatusCache, type Check, type Ctx } from "./checks";

/**
 * TLS for the probe's database connection, as the API decides it (apps/api/src/db.ts):
 * Railway's private network and a local Postgres are plain TCP; any other
 * host gets TLS with full certificate verification, against DATABASE_CA_CERT
 * (PEM) when the provider signs with its own root.
 */
export function sslFor(url: string, caCert = process.env.DATABASE_CA_CERT): { ssl?: true | { ca: string } } {
  const host = new URL(url).hostname;
  const internal = host.endsWith(".railway.internal") || host === "localhost" || host === "127.0.0.1";
  return internal ? {} : { ssl: caCert ? { ca: caCert } : true };
}

export interface RunReport {
  ok: string[];
  failing: { key: string; reason: string }[];
}

/**
 * One probe run: every check (confirmed by a retry), then alerts. A check that
 * starts failing alerts at once and again every `repeatMs`; one that recovers
 * sends a single "recovered". State is in Postgres, shared with the API.
 */
export async function runOnce(opts: { checks?: Check[]; ctx: Ctx; alerter: Alerter; db?: Queryable; retryMs?: number }): Promise<RunReport> {
  resetStatusCache();
  const checks = opts.checks ?? CHECKS;
  const results = await Promise.all(checks.map(async (c) => ({ c, r: await confirm(c, opts.ctx, opts.retryMs) })));
  const report: RunReport = { ok: [], failing: [] };
  for (const { c, r } of results) {
    if (r.ok) {
      report.ok.push(c.key);
      await opts.alerter.clear(`probe:${c.key}`, `${c.name} is back to normal`);
    } else {
      report.failing.push({ key: c.key, reason: r.reason });
      await opts.alerter.raise(`probe:${c.key}`, `${c.name}: ${r.reason}`);
    }
  }
  // The heartbeat is best effort: a database problem must not stop the alerts above (it fails the backup check instead).
  if (opts.db) await beat(opts.db, "probe", report.failing.length ? `failing: ${report.failing.map((f) => f.key).join(", ")}` : "all ok").catch((e: Error) => console.error(JSON.stringify({ level: "error", msg: "probe heartbeat not recorded", error: e.message })));
  return report;
}
