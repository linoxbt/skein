import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { reproduce } from "@skein/engine";
import { catalogueFromSnapshot, runVerdict } from "@skein/pipeline";
import { getPolicy } from "@skein/policies";
import { TelegraphClient, TESTNET, viemSigner } from "@skein/telegraph";
import { FakeNode } from "@skein/telegraph/testing";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { loadStoredVerdict, MIGRATIONS_DIR, saveVerdictRun, schema, type Db } from "../src";

const SEASON = Date.parse("2026-11-03T10:00:00Z");
const subject = { chainId: 8453, token: "0x4200000000000000000000000000000000000006" };
const snapshot = JSON.parse(readFileSync(new URL("../../telegraph/snapshots/2026-10-30.json", import.meta.url), "utf8"));

async function aRun(sanctionsHangs = false) {
  const answers: Record<string, unknown> = {
    "200001": { result: { [subject.token]: { is_honeypot: "0", is_open_source: "1", buy_tax: "0", sell_tax: "0" } } },
    "78021": { on_list: false },
    "7373": { liquidity_usd: 4_500_000 },
    "7302": { holders_count: 120_000 },
    "7378": { verdict: "organic", wash_volume_pct: 3 },
  };
  const node = new FakeNode({
    nowSec: () => Math.floor(SEASON / 1000),
    respond: (id) => (sanctionsHangs && id === "78021" ? { kind: "hang" } : { kind: "answer", result: answers[id] ?? {} }),
  });
  const client = new TelegraphClient({
    network: TESTNET, signer: viemSigner(`0x${"22".repeat(32)}`), fetch: node.fetch, maxUusdcPerCall: 50_000, now: () => SEASON,
  });
  const policy = getPolicy("dex-list@0.1.0").policy;
  policy.budget.per_check_timeout_ms.sanctions = 30;
  const run = await runVerdict(
    { policy, subject, context: {} },
    { client, catalogue: catalogueFromSnapshot(snapshot), priceUusdc: 250_000, resolver: { resolve: async () => "0xd0b53d9277642d899df5c87a3966a349a798f224" } },
  );
  if (!run.ok) throw new Error("plan refused");
  return run;
}

let db: Db;
let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema }) as unknown as Db;
  await migrate(drizzle(pg), { migrationsFolder: MIGRATIONS_DIR });
});

/** Drizzle wraps the Postgres error; the database's own message is in `cause`. */
async function refused(p: Promise<unknown>, pattern: RegExp) {
  const err = await p.then(() => null, (e: Error & { cause?: Error }) => e);
  expect(err, "expected the database to refuse").not.toBeNull();
  expect(err!.cause?.message ?? err!.message).toMatch(pattern);
}

const meta = { channel: "cli" as const, network: "telegraph-testnet", priceUusdc: 250_000, durationMs: 900 };

describe("verdict store", () => {
  it("a saved verdict loads back and reproduces its hash and BOM root", async () => {
    const run = await aRun();
    const id = await saveVerdictRun(db, run, meta);
    const stored = await loadStoredVerdict(db, id);
    expect(stored).not.toBeNull();
    expect(stored!.verdictHash).toBe(run.verdict.verdictHash);
    expect(reproduce(stored!, getPolicy("dex-list@0.1.0").policy)).toMatchObject({ ok: true, problems: [] });
    const [row] = await db.select().from(schema.verdicts);
    expect(row).toMatchObject({ verdict: run.verdict.decision.verdict, upstreamUusdc: 50_000, bomItems: 5 });
  });

  it("failed purchases are stored too, and their verdict still reproduces", async () => {
    const run = await aRun(true);
    const id = await saveVerdictRun(db, run, meta);
    const stored = (await loadStoredVerdict(db, id))!;
    expect(run.verdict.decision.verdict).toBe("ABSTAIN");
    expect(stored.purchases!.find((p) => p.check === "sanctions")).toMatchObject({ error: expect.stringMatching(/^timeout/) });
    expect(reproduce(stored, getPolicy("dex-list@0.1.0").policy).ok).toBe(true);
  });

  it("purchases, findings and verdicts are append-only, for every role", async () => {
    await refused(db.execute(sql`update purchases set amount_uusdc = 0`), /purchases is append-only: UPDATE refused/);
    await refused(db.execute(sql`delete from findings`), /findings is append-only: DELETE refused/);
    await refused(db.execute(sql`update verdicts set verdict = 'APPROVE'`), /verdicts is append-only/);
  });

  it("a published policy is immutable", async () => {
    await db.insert(schema.policies).values({ id: "dex-list", version: "0.1.0", yaml: "id: dex-list", sha256: "ab" });
    await refused(db.execute(sql`update policies set yaml = 'x'`), /policies is append-only/);
    await expect(db.insert(schema.policies).values({ id: "dex-list", version: "0.1.0", yaml: "y", sha256: "cd" })).rejects.toThrow();
  });

  it("an idempotency key is unique per consumer", async () => {
    const [c] = await db.insert(schema.consumers).values({ name: "desk", kind: "agent" }).returning();
    const run = await aRun();
    await saveVerdictRun(db, run, { ...meta, consumerId: c!.id, idempotencyKey: "k1" });
    await expect(saveVerdictRun(db, run, { ...meta, consumerId: c!.id, idempotencyKey: "k1" })).rejects.toThrow();
  });

  it("a receipt can back only one purchase", async () => {
    const run = await aRun();
    await saveVerdictRun(db, run, meta);
    await expect(saveVerdictRun(db, run, meta)).rejects.toThrow();
  });

  it("row level security is enabled on every table", async () => {
    const res = await pg.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'",
    );
    expect(res.rows.length).toBe(12);
    expect(res.rows.filter((r) => !r.relrowsecurity)).toEqual([]);
  });
});
