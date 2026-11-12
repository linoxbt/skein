import { lastBeat, type Queryable } from "@skein/alerts";

/** One check's outcome: ok, or a short reason a person can act on. */
export type Result = { ok: true } | { ok: false; reason: string };
export interface Check {
  key: string;
  name: string;
  run(ctx: Ctx): Promise<Result>;
}
export interface Ctx {
  fetch: typeof fetch;
  db?: Queryable;
  now: () => number;
}

const API = process.env.PROBE_API_URL ?? "https://api.skeinlabs.site";
const WEB = process.env.PROBE_WEB_URL ?? "https://skeinlabs.site";
const DESK = process.env.PROBE_DESK_URL ?? "https://desk.skeinlabs.site";
const SNIPER = process.env.PROBE_SNIPER_URL ?? "https://sniper-production-bea6.up.railway.app";
const NODE = process.env.TELEGRAPH_NODE_URL ?? "https://devnode.telegraphprotocol.com";
const MINER_ID = process.env.SKEIN_MINER_REGISTRATION ?? "5137";

async function get(ctx: Ctx, url: string): Promise<{ status: number; body: string }> {
  const res = await ctx.fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "follow", headers: { "user-agent": "skein-probe" } });
  return { status: res.status, body: await res.text() };
}

/** An HTTP check: the status must match, and an optional test on the body must pass. */
function http(key: string, name: string, url: string, want = 200, test?: (body: string) => string | null): Check {
  return {
    key,
    name,
    async run(ctx) {
      try {
        const r = await get(ctx, url);
        if (r.status !== want) return { ok: false, reason: `HTTP ${r.status} (want ${want}) from ${url}` };
        const bad = test?.(r.body);
        return bad ? { ok: false, reason: bad } : { ok: true };
      } catch (e) {
        return { ok: false, reason: `${url}: ${(e as Error).message}` };
      }
    },
  };
}

const json = (body: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/** The /v1/status checks share one request per run. */
let statusCache: Promise<{ status: number; body: string }> | null = null;
function status(key: string, name: string, test: (s: Record<string, unknown>) => string | null): Check {
  return {
    key,
    name,
    async run(ctx) {
      try {
        statusCache ??= get(ctx, `${API}/v1/status`);
        const r = await statusCache;
        if (r.status !== 200) return { ok: false, reason: `/v1/status answered HTTP ${r.status}` };
        const s = json(r.body);
        if (!s) return { ok: false, reason: "/v1/status is not JSON" };
        const bad = test(s);
        return bad ? { ok: false, reason: bad } : { ok: true };
      } catch (e) {
        return { ok: false, reason: `/v1/status: ${(e as Error).message}` };
      }
    },
  };
}
export const resetStatusCache = () => {
  statusCache = null;
};

const BACKUP_MAX_AGE_H = Number(process.env.PROBE_BACKUP_MAX_AGE_H ?? 26);
/** Quality alarms, over /v1/status's 3-hour window; small samples are not judged. */
const MIN_VERDICTS = Number(process.env.PROBE_MIN_VERDICTS ?? 5);
const MAX_ABSTAIN_SHARE = Number(process.env.PROBE_MAX_ABSTAIN_SHARE ?? 0.5);
const MIN_PURCHASES = Number(process.env.PROBE_MIN_PURCHASES ?? 10);
const MAX_PURCHASE_ERROR_SHARE = Number(process.env.PROBE_MAX_PURCHASE_ERROR_SHARE ?? 0.5);

const MAX_P95_MS = Number(process.env.PROBE_MAX_P95_MS ?? 10_000);

type Quality = { windowHours: number; verdicts: number; abstain: number; abstainFailed?: number; purchases: number; purchaseErrors: number; verdictP95Ms?: number | null };
const quality = (s: Record<string, unknown>) => (s.quality && typeof s.quality === "object" ? (s.quality as Quality) : null);
const pct = (x: number) => `${Math.round(x * 100)}%`;

export const CHECKS: Check[] = [
  http("api", "API process", `${API}/healthz`),
  http("api-db", "API database", `${API}/readyz`),
  status("escrow", "Purchaser escrow", (s) => {
    if (s.walletAlert === true) return `escrow at ${s.payerEscrowUsdc} USDC, below the alert level: deposit more (docs/RUNBOOK.md)`;
    // Unknown is not fine: the API could not read the chain, or has no payer, and would buy blind.
    if (s.payerEscrowUsdc === null || s.payerEscrowUsdc === undefined) return "the purchaser's escrow balance is unknown: the API cannot read it (RPC_URL) or has no payer key";
    if (s.paused === true) return `uncached verdicts are paused: ${String(s.pausedReason ?? "unknown reason")}`;
    return null;
  }),
  status("cap", "Daily spend cap", (s) => (s.capAlert === true ? `spent ${s.spentTodayUsdc} of ${s.dailyCapUsdc} USDC today` : null)),
  status("db-role", "Least-privilege database role", (s) => (typeof s.dbRole === "string" && s.dbRole !== "skein_app" ? `the API is querying as "${s.dbRole}", not skein_app: see the API's startup log` : null)),
  status("errors", "Unhandled API errors", (s) => (Number(s.errorsLastHour) > 0 ? `${s.errorsLastHour} unhandled error(s) in the last hour: see error_log or the API logs by request id` : null)),
  // Counts only ABSTAINs caused by failed purchases: a policy may abstain by design.
  status("abstain", "ABSTAIN share", (s) => {
    const q = quality(s);
    if (!q || q.verdicts < MIN_VERDICTS) return null;
    const failed = q.abstainFailed ?? q.abstain;
    const share = failed / q.verdicts;
    return share > MAX_ABSTAIN_SHARE ? `${failed} of ${q.verdicts} verdicts in the last ${q.windowHours} h were ABSTAIN on a failed purchase (${pct(share)}, limit ${pct(MAX_ABSTAIN_SHARE)}): see /v1/ledger abstain.causes` : null;
  }),
  status("purchases", "Upstream purchases", (s) => {
    const q = quality(s);
    if (!q || q.purchases < MIN_PURCHASES) return null;
    const share = q.purchaseErrors / q.purchases;
    return share > MAX_PURCHASE_ERROR_SHARE ? `${q.purchaseErrors} of ${q.purchases} purchases in the last ${q.windowHours} h failed (${pct(share)}, limit ${pct(MAX_PURCHASE_ERROR_SHARE)}): read a recent verdict's /bom errors` : null;
  }),
  // Spec §15: alert when p95 verdict latency passes 10 s (bought verdicts of the last 3 h; small samples are not judged).
  status("latency", "Verdict latency", (s) => {
    const q = quality(s);
    if (!q || q.verdicts < MIN_VERDICTS || q.verdictP95Ms == null) return null;
    return q.verdictP95Ms > MAX_P95_MS ? `p95 verdict latency is ${(q.verdictP95Ms / 1000).toFixed(1)} s over the last ${q.windowHours} h (limit ${MAX_P95_MS / 1000} s): see /v1/status intents for the slow check` : null;
  }),
  // The pinned OFAC address list must not go stale (audit M2): refresh it with scripts/ofac-snapshot.py.
  status("ofac", "OFAC snapshot", (s) => {
    const o = s.ofacSnapshot as { stale?: boolean; ageDays?: number | null; maxAgeDays?: number; fetched?: string } | undefined;
    if (!o) return null;
    return o.stale === true ? `the OFAC SDN snapshot is ${o.ageDays ?? "?"} days old (fetched ${o.fetched}, limit ${o.maxAgeDays}): refresh it` : null;
  }),
  // Spec §15: a repro mismatch alerts. The newest verdict is re-verified each run.
  {
    key: "repro",
    name: "Verdict reproduction",
    async run(ctx) {
      try {
        const l = await get(ctx, `${API}/v1/ledger`);
        if (l.status !== 200) return { ok: false, reason: `/v1/ledger answered HTTP ${l.status}` };
        const id = (json(l.body)?.recent as { id?: string }[] | undefined)?.[0]?.id;
        if (!id) return { ok: true };
        const res = await ctx.fetch(`${API}/v1/verify`, { method: "POST", headers: { "content-type": "application/json", "user-agent": "skein-probe" }, body: JSON.stringify({ id }), signal: AbortSignal.timeout(60_000) });
        if (res.status === 429) return { ok: true }; // rate-limited: try again next run
        const r = json(await res.text());
        if (res.status !== 200 || !r) return { ok: false, reason: `/v1/verify answered HTTP ${res.status} for ${id}` };
        if (r.ok === true) return { ok: true };
        const failing = Object.entries((r.checks as Record<string, unknown>) ?? {}).filter(([, v]) => v === false).map(([k]) => k);
        return { ok: false, reason: `verdict ${id} does not reproduce (${failing.join(", ") || "see problems"}): ${((r.problems as string[]) ?? []).slice(0, 3).join("; ")}` };
      } catch (e) {
        return { ok: false, reason: `repro check: ${(e as Error).message}` };
      }
    },
  },
  http("web", "Web console", `${WEB}/`),
  http("web-404", "Web 404 pages", `${WEB}/v/vrd_doesnotexist`, 404),
  http("desk", "Skein Desk queue", `${DESK}/api/applications`),
  http("sniper", "Skein Sniper", `${SNIPER}/healthz`),
  http("miner", "Telegraph miner", `${NODE}/api/miners/${MINER_ID}`, 200, (b) => (/"activation_status":"active"/.test(b) ? null : `miner ${MINER_ID} is not active on the Telegraph node`)),
  {
    key: "backup",
    name: "Nightly backup",
    async run(ctx) {
      if (!ctx.db) return { ok: true };
      const at = await lastBeat(ctx.db, "backup");
      if (!at) return { ok: false, reason: "no backup has ever been recorded" };
      const hours = (ctx.now() - at.getTime()) / 3_600_000;
      return hours > BACKUP_MAX_AGE_H ? { ok: false, reason: `the last backup ran ${hours.toFixed(1)} h ago (limit ${BACKUP_MAX_AGE_H} h)` } : { ok: true };
    },
  },
];

/** Runs a check twice, a few seconds apart, before calling it failed: one blip is not an outage. */
export async function confirm(check: Check, ctx: Ctx, retryMs = 5_000): Promise<Result> {
  const first = await safe(check, ctx);
  if (first.ok) return first;
  await new Promise((r) => setTimeout(r, retryMs));
  resetStatusCache();
  return safe(check, ctx);
}

/** A check that throws (its database is down, a table is missing) is a failed check, never a failed run. */
async function safe(check: Check, ctx: Ctx): Promise<Result> {
  try {
    return await check.run(ctx);
  } catch (e) {
    return { ok: false, reason: `the check itself failed: ${(e as Error).message}` };
  }
}
