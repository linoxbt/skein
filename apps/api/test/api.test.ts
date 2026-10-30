import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { MIGRATIONS_DIR, schema, type Db } from "@skein/db";
import { catalogueFromSnapshot } from "@skein/pipeline";
import { TelegraphClient, TESTNET, viemSigner } from "@skein/telegraph";
import { FakeNode } from "@skein/telegraph/testing";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { configFromEnv } from "../src/config";
import { VerdictService } from "../src/service";

const SEASON = Date.parse("2026-11-03T10:00:00Z");
const snapshot = JSON.parse(readFileSync(new URL("../../../packages/telegraph/snapshots/2026-10-30.json", import.meta.url), "utf8"));
const TOKEN = "0x4200000000000000000000000000000000000006";
const KEY = "sk_part_test_key";
const MINER_KEY = "miner-secret";

const ANSWERS: Record<string, unknown> = {
  "200001": { result: { [TOKEN]: { is_honeypot: "0", is_open_source: "1", buy_tax: "0", sell_tax: "0" } } },
  "78021": { on_list: false },
  "7373": { liquidity_usd: 4_500_000 },
  "7302": { holders_count: 120_000 },
  "7378": { verdict: "organic", wash_volume_pct: 3 },
  "7457": { verdict: "human" },
};

let node: FakeNode;
let app: ReturnType<typeof createApp>;
let service: VerdictService;

beforeEach(async () => {
  const pg = new PGlite();
  await migrate(drizzle(pg), { migrationsFolder: MIGRATIONS_DIR });
  const db = drizzle(pg, { schema }) as unknown as Db;
  await db.insert(schema.consumers).values({ name: "desk", kind: "agent", apiKeyHash: createHash("sha256").update(KEY).digest("hex") });
  node = new FakeNode({ nowSec: () => Math.floor(SEASON / 1000), respond: (id) => ({ kind: "answer", result: ANSWERS[id] ?? {} }) });
  const client = new TelegraphClient({ network: TESTNET, signer: viemSigner(`0x${"33".repeat(32)}`), fetch: node.fetch, maxUusdcPerCall: 50_000, now: () => SEASON });
  service = new VerdictService({
    db,
    config: { ...configFromEnv({}), minerAuthKey: MINER_KEY, defaultPolicy: "dex-list" },
    client,
    catalogue: catalogueFromSnapshot(snapshot),
    resolver: { resolve: async () => "0xd0b53d9277642d899df5c87a3966a349a798f224" },
    now: () => new Date(SEASON),
  });
  app = createApp(service);
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  app.request("/v1/verdicts", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, "idempotency-key": "k1", ...headers },
    body: JSON.stringify(body),
  });
// biome-ignore: test bodies are read loosely
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = async (r: Response | Promise<Response>): Promise<any> => (await r).json();

const body = { subject: { chainId: 8453, token: TOKEN }, policy: "dex-list", context: { socialHandle: "base" } };

describe("POST /v1/verdicts", () => {
  it("runs a verdict and returns the spec's verdict object with hash headers", async () => {
    const res = await post(body);
    expect(res.status).toBe(200);
    const v = await j(res);
    expect(v).toMatchObject({ verdict: "APPROVE", verdictCode: 1, coverage: 1, policy: { id: "dex-list", version: "0.1.0" }, network: "testnet", cost: { upstreamUsdc: 0.06, priceUsdc: 0.25 } });
    expect(res.headers.get("x-skein-verdict-hash")).toBe(v.verdictHash);
    expect(res.headers.get("x-skein-bom-root")).toBe(v.bom.root);
    expect(node.charges).toHaveLength(6);

    const bom = await j(app.request(`/v1/verdicts/${v.id}/bom`));
    expect(bom.lines).toHaveLength(6);
    expect(bom.lines.every((l: { billed: boolean }) => l.billed)).toBe(true);

    const verify = await j(app.request("/v1/verify", { method: "POST", body: JSON.stringify({ id: v.id }) }));
    expect(verify).toMatchObject({ ok: true, checks: { adaptersRerun: true, policyRerun: true, bomRootRebuilt: true } });
  });

  it("asks for a key, rejects a bad one, and requires an Idempotency-Key", async () => {
    expect((await app.request("/v1/verdicts", { method: "POST", body: "{}" })).status).toBe(402);
    expect((await post(body, { authorization: "Bearer nope" })).status).toBe(401);
    const res = await app.request("/v1/verdicts", { method: "POST", headers: { authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) });
    expect((await j(res)).error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("replays an idempotent request without charging again, and refuses a changed body", async () => {
    const a = await j(post(body));
    const b = await j(post(body));
    expect(b).toMatchObject({ id: a.id, replayed: true });
    expect(node.charges).toHaveLength(6);
    const c = await post({ ...body, budgetUsdcMax: 0.15 });
    expect(c.status).toBe(409);
    expect((await j(c)).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("serves the same token and policy from cache for 10 minutes, free", async () => {
    const a = await j(post(body));
    const res = await post(body, { "idempotency-key": "k2" });
    expect(res.headers.get("x-skein-cache")).toBe("hit");
    expect(await j(res)).toMatchObject({ id: a.id, cached: true });
    expect(node.charges).toHaveLength(6);
  });

  it("maps planner refusals to the spec's errors, before any purchase", async () => {
    const cex = await post({ ...body, policy: "cex-standard" });
    expect(cex.status).toBe(503);
    expect((await j(cex)).error).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", details: { checks: ["holder_concentration"] } });
    const low = await post({ ...body, budgetUsdcMax: 0.02 }, { "idempotency-key": "k3" });
    expect(low.status).toBe(422);
    expect((await j(low)).error).toMatchObject({ code: "BUDGET_TOO_LOW", details: { quoteUsdc: 0.04 } });
    expect(node.charges).toHaveLength(0);
  });

  it("rejects a bad subject and an unknown policy", async () => {
    const bad = await post({ ...body, subject: { chainId: 8453, token: "0x1234" } });
    expect((await j(bad)).error.code).toBe("INVALID_SUBJECT");
    const chain = await post({ ...body, subject: { chainId: 137, token: TOKEN } }, { "idempotency-key": "k4" });
    expect((await j(chain)).error.code).toBe("INVALID_SUBJECT");
    const pol = await post({ ...body, policy: "nope@1.0.0" }, { "idempotency-key": "k5" });
    expect((await j(pol)).error.code).toBe("UNKNOWN_POLICY");
  });

  it("async mode returns 202 and streams plan, purchases, findings, decision and done over SSE", async () => {
    const res = await post({ ...body, mode: "async" });
    expect(res.status).toBe(202);
    const { id } = await j(res);
    const sse = await (await app.request(`/v1/verdicts/${id}/events`)).text();
    const types = [...sse.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);
    expect(types[0]).toBe("plan");
    expect(types.filter((t) => t === "purchase")).toHaveLength(6);
    expect(types).toContain("decision");
    expect(types.at(-1)).toBe("done");
    expect((await app.request(`/v1/verdicts/${id}`)).status).toBe(200);
  });
});

describe("read-only routes", () => {
  it("quote, status, policies and ledger", async () => {
    const q = await j(app.request(`/v1/quote?chain=8453&token=${TOKEN}&policy=dex-list`));
    expect(q).toMatchObject({ ok: true, upstreamUsdc: 0.06, priceUsdc: 0.25 });
    const s = await j(app.request("/v1/status"));
    expect(s).toMatchObject({ network: "eip155:11155111" });
    expect(s.intents.find((i: { check: string }) => i.check === "holder_concentration")).toMatchObject({ intent: null, activeMiners: 0 });
    const ps = await j(app.request("/v1/policies"));
    expect(ps.map((p: { ref: string }) => p.ref)).toEqual(["agent-pretrade@0.1.0", "cex-standard@0.1.0", "dex-list@0.1.0"]);
    await post(body);
    const l = await j(app.request("/v1/ledger"));
    expect(l).toMatchObject({ verdicts: { APPROVE: 1 }, upstreamSpendUsdc: 0.06, receipts: 6, minersUsed: 6 });
  });
});

describe("POST /miner/verdict (the Telegraph dispatcher)", () => {
  const minerPost = (b: unknown, h: Record<string, string> = {}) =>
    app.request("/miner/verdict", { method: "POST", headers: { "content-type": "application/json", "x-skein-miner-key": MINER_KEY, ...h }, body: JSON.stringify(b) });

  it("refuses without the miner key", async () => {
    expect((await minerPost({ token: TOKEN, chain: "base" }, { "x-skein-miner-key": "wrong" })).status).toBe(401);
  });

  it("answers the YAML's declared params with the signal-mapping fields", async () => {
    const res = await minerPost({ token: TOKEN, chain: "base", policy: "dex-list" });
    expect(res.status).toBe(200);
    const v = await j(res);
    // No social handle on this path: one optional check is missing, still APPROVE.
    expect(v).toMatchObject({ verdict: "APPROVE", verdict_code: 1, cached: false });
    expect(typeof v.confidence).toBe("number");
    expect(v.bom.root).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("never re-buys a nested request that came back from Skein's own purchase", async () => {
    const res = await minerPost({ token: TOKEN, chain: "base", policy: "dex-list" }, { "x-skein-depth": "1" });
    expect(res.status).toBe(409);
    expect(node.charges).toHaveLength(0);
  });
});
