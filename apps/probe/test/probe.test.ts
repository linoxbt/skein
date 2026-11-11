import { PGlite } from "@electric-sql/pglite";
import { Alerter, beat } from "@skein/alerts";
import { MIGRATIONS_DIR } from "@skein/db";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CHECKS } from "../src/checks";
import { runOnce } from "../src/run";

let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await migrate(drizzle(pg), { migrationsFolder: MIGRATIONS_DIR });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

/** A fake internet: every service healthy unless `broken` says otherwise. */
function world(broken: Set<string>, status: Record<string, unknown> = {}) {
  const pushes: { title: string; body: string }[] = [];
  const f = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://ntfy.sh/")) {
      pushes.push({ title: String((init?.headers as Record<string, string>).Title), body: String(init?.body) });
      return new Response("ok");
    }
    if (broken.has("api") && url.includes("/healthz") && url.includes("api.")) return new Response("down", { status: 502 });
    if (url.endsWith("/v1/status")) return Response.json({ walletAlert: false, capAlert: false, errorsLastHour: 0, payerEscrowUsdc: 108, ...status });
    if (url.includes("/v/vrd_doesnotexist")) return new Response("nf", { status: 404 });
    if (url.includes("/api/miners/")) return new Response('{"activation_status":"active"}');
    return new Response("ok");
  }) as unknown as typeof fetch;
  return { f, pushes };
}

describe("probe", () => {
  it("covers every public service, the escrow, the cap, errors, the miner and the backup", () => {
    expect(CHECKS.map((c) => c.key)).toEqual(["api", "api-db", "escrow", "cap", "db-role", "errors", "abstain", "purchases", "web", "web-404", "desk", "sniper", "miner", "backup"]);
  });

  it("alerts once when something breaks, stays quiet while it stays broken, and says when it recovers", async () => {
    await beat(pg, "backup");
    const broken = new Set<string>();
    const w = world(broken);
    const alerter = new Alerter({ url: "https://ntfy.sh/skein-test", service: "skein-probe", db: pg, fetch: w.f });
    const run = () => runOnce({ ctx: { fetch: w.f, db: pg, now: Date.now }, alerter, db: pg, retryMs: 1 });

    expect((await run()).failing).toEqual([]);
    expect(w.pushes).toHaveLength(0);

    broken.add("api");
    const r = await run();
    expect(r.failing.map((x) => x.key)).toEqual(["api"]);
    expect(w.pushes).toHaveLength(1);
    expect(w.pushes[0]!.title).toContain("probe:api");
    expect(w.pushes[0]!.body).toContain("HTTP 502");

    await run(); // still broken: no repeat inside the window
    expect(w.pushes).toHaveLength(1);

    broken.delete("api");
    await run();
    expect(w.pushes).toHaveLength(2);
    expect(w.pushes[1]!.title).toContain("recovered");
  });

  it("raises the escrow, error and backup alarms from their sources", async () => {
    const w = world(new Set(), { walletAlert: true, payerEscrowUsdc: 1.2, errorsLastHour: 3 });
    const alerter = new Alerter({ url: "https://ntfy.sh/skein-test", service: "skein-probe", db: pg, fetch: w.f });
    await pg.query(`UPDATE heartbeats SET at = now() - interval '30 hours' WHERE name = 'backup'`);
    const r = await runOnce({ ctx: { fetch: w.f, db: pg, now: Date.now }, alerter, db: pg, retryMs: 1 });
    expect(r.failing.map((x) => x.key).sort()).toEqual(["backup", "errors", "escrow"]);
    const bodies = w.pushes.map((p) => p.body).join("\n");
    expect(bodies).toContain("escrow at 1.2 USDC");
    expect(bodies).toContain("3 unhandled error(s)");
    expect(bodies).toMatch(/last backup ran 30\.\d h ago/);
    const beats = await pg.query<{ name: string; detail: string }>(`SELECT name, detail FROM heartbeats WHERE name = 'probe'`);
    expect(beats.rows[0]!.detail).toContain("failing");
  });

  it("alerts on a burst of ABSTAINs or failed purchases, and ignores small samples", async () => {
    const quality = { windowHours: 3, verdicts: 12, abstain: 12, purchases: 48, purchaseErrors: 48 };
    const w = world(new Set(), { quality });
    const alerter = new Alerter({ url: "https://ntfy.sh/skein-test", service: "skein-probe", db: pg, fetch: w.f });
    await beat(pg, "backup");
    const r = await runOnce({ ctx: { fetch: w.f, db: pg, now: Date.now }, alerter, db: pg, retryMs: 1 });
    expect(r.failing.map((x) => x.key).sort()).toEqual(["abstain", "purchases"]);
    const bodies = w.pushes.map((p) => p.body).join("\n");
    expect(bodies).toContain("12 of 12 verdicts in the last 3 h were ABSTAIN");
    expect(bodies).toContain("48 of 48 purchases in the last 3 h failed");

    const small = world(new Set(), { quality: { windowHours: 3, verdicts: 2, abstain: 2, purchases: 4, purchaseErrors: 4 } });
    const quiet = await runOnce({ ctx: { fetch: small.f, db: pg, now: Date.now }, alerter: new Alerter({ url: "https://ntfy.sh/skein-test", service: "skein-probe", db: pg, fetch: small.f }), db: pg, retryMs: 1 });
    expect(quiet.failing.map((x) => x.key)).not.toContain("abstain");
    expect(quiet.failing.map((x) => x.key)).not.toContain("purchases");
  });

  it("keeps checking and alerting when its database is broken", async () => {
    const broken = { query: async () => { throw new Error('relation "heartbeats" does not exist'); } };
    const w = world(new Set(["api"]));
    const alerter = new Alerter({ url: "https://ntfy.sh/skein-test", service: "skein-probe", db: broken, fetch: w.f });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runOnce({ ctx: { fetch: w.f, db: broken, now: Date.now }, alerter, db: broken, retryMs: 1 });
    expect(r.failing.map((x) => x.key).sort()).toEqual(["api", "backup"]);
    expect(r.failing.find((x) => x.key === "backup")!.reason).toContain("heartbeats");
    expect(w.pushes.length).toBeGreaterThanOrEqual(2); // alerts still went out, deduplicated in memory
  });
});
