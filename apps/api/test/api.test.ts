import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { MIGRATIONS_DIR, schema, type Db } from "@skein/db";
import { catalogueFromSnapshot } from "@skein/pipeline";
import { TelegraphClient, TESTNET, viemSigner } from "@skein/telegraph";
import { FakeNode } from "@skein/telegraph/testing";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { attestationMessage } from "@skein/engine";
import { verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp, riskLevel, riskScore, subjectFromText } from "../src/app";
import { configFromEnv } from "../src/config";
import { VerdictService } from "../src/service";

const SEASON = Date.parse("2026-11-03T10:00:00Z");
const snapshot = JSON.parse(readFileSync(new URL("../../../packages/telegraph/snapshots/2026-10-30.json", import.meta.url), "utf8"));
const TOKEN = "0x4200000000000000000000000000000000000006";
const ATTESTATION_KEY = `0x${"ab".repeat(32)}` as const;
const ATTESTER = privateKeyToAccount(ATTESTATION_KEY).address;
const KEY = "sk_part_test_key";
const MINER_KEY = "miner-secret";

const ANSWERS: Record<string, unknown> = {
  "200001": { result: { [TOKEN]: { is_honeypot: "0", is_open_source: "1", buy_tax: "0", sell_tax: "0" } } },
  "78021": { on_list: false },
  "7373": { liquidity_usd: 4_500_000 },
  "9002": { holders_count: 120_000 },
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
    config: { ...configFromEnv({}), minerAuthKey: MINER_KEY, defaultPolicy: "dex-list", attestationKey: ATTESTATION_KEY },
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
    // The bare id is dex-list@0.2.0: no repo in this request, so its optional code review is not bought.
    expect(v).toMatchObject({ verdict: "APPROVE", verdictCode: 1, coverage: 0.93, policy: { id: "dex-list", version: "0.2.0" }, network: "testnet", cost: { upstreamUsdc: 0.06, priceUsdc: 0.25 } });
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
    // The quote prices every check the policy may buy, the optional code review included.
    expect(q).toMatchObject({ ok: true, upstreamUsdc: 0.07, priceUsdc: 0.25, policy: "dex-list@0.2.0" });
    expect((await j(app.request(`/v1/quote?chain=8453&token=${TOKEN}&policy=dex-list@0.1.0`))).upstreamUsdc).toBe(0.06);
    const s = await j(app.request("/v1/status"));
    expect(s).toMatchObject({ network: "eip155:11155111" });
    expect(s.intents.find((i: { check: string }) => i.check === "holder_concentration")).toMatchObject({ intent: null, activeMiners: 0 });
    const ps = await j(app.request("/v1/policies"));
    expect(ps.map((p: { ref: string }) => p.ref)).toEqual(["agent-pretrade@0.1.0", "agent-pretrade@0.2.0", "agent-pretrade@0.3.0", "cex-standard@0.1.0", "dex-list@0.1.0", "dex-list@0.2.0"]);
    await post(body);
    const l = await j(app.request("/v1/ledger"));
    expect(l).toMatchObject({ verdicts: { APPROVE: 1 }, upstreamSpendUsdc: 0.06, receipts: 6, minersUsed: 6 });
    expect(l.stability).toMatchObject({ byEngine: [] });
    expect(s.quality).toMatchObject({ windowHours: 3 });
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

  it("never buys an intent in its own family, so a request can never route back to Skein", async () => {
    const res = await minerPost({ token: TOKEN, chain: "base", policy: "dex-list" });
    expect(res.status).toBe(200);
    const asked = node.charges.map((c) => c.minerId);
    expect(asked.length).toBeGreaterThan(0);
    // Every purchase is an allowlisted check miner; none is in the FRAUD_RISK family Skein serves.
    const purchases = await j(app.request(`/v1/verdicts/${(await j(minerPost({ token: TOKEN, chain: "base" }))).id}/bom`));
    expect(purchases.lines.every((l: { intent: string }) => !l.intent.startsWith("FRAUD_RISK"))).toBe(true);
  });

  it("accepts a numeric chain id, a params wrapper and Plan B's subject string, and answers bom_root and reasons", async () => {
    for (const body of [{ token: TOKEN, chain: 8453 }, { params: { token: TOKEN, chain: "base" } }, { subject: TOKEN, chain: "8453" }]) {
      const res = await minerPost(body);
      expect(res.status, JSON.stringify(body)).toBe(200);
      const out = await j(res);
      expect(out).toMatchObject({ verdict: "APPROVE", risk_level: "LOW" });
      expect(out.bom_root).toMatch(/^0x[0-9a-f]{64}$/);
      expect(Array.isArray(out.reasons)).toBe(true);
    }
  });

  it("answers Plan B's request, which is one subject string with no chain field", async () => {
    for (const subject of [`eip155:8453:${TOKEN}`, `base:${TOKEN}`, `8453:${TOKEN}`, `${TOKEN} on Base`]) {
      const res = await minerPost({ subject });
      expect(res.status, subject).toBe(200);
      const out = await j(res);
      expect(out, subject).toMatchObject({ verdict: "APPROVE", risk_level: "LOW" });
      expect(out.risk_score).toBeGreaterThanOrEqual(0);
      expect(out.risk_score).toBeLessThanOrEqual(1);
      expect(Array.isArray(out.signals)).toBe(true);
      expect((await j(app.request(`/v1/verdicts/${out.id}`))).subject.chainId).toBe(8453);
    }
  });

  it("runs one verdict for concurrent dispatcher calls about the same token", async () => {
    const token = "0x0000000000000000000000000000000000c0ffe0";
    const outs = await Promise.all(Array.from({ length: 5 }, () => j(minerPost({ token, chain: "base" }))));
    expect(new Set(outs.map((o) => o.id)).size).toBe(1);
    expect(node.charges.length).toBeLessThanOrEqual(6);
  });
});

describe("plan B helpers", () => {
  const T = "0x4200000000000000000000000000000000000006";
  it("reads the chain out of a free-text subject", () => {
    expect(subjectFromText(`eip155:42161:${T}`)).toEqual({ token: T, chain: "42161" });
    expect(subjectFromText(`bsc:${T}`)).toEqual({ token: T, chain: "bsc" });
    expect(subjectFromText(`BNB token ${T}`)).toEqual({ token: T, chain: "bsc" });
    expect(subjectFromText(`56:${T}`)).toEqual({ token: T, chain: "56" });
    expect(subjectFromText(`token ${T} on ethereum`)).toEqual({ token: T, chain: "ethereum" });
    expect(subjectFromText(T)).toEqual({ token: T });
    expect(subjectFromText("not an address")).toBeUndefined();
  });
  it("maps verdicts to the intent's risk levels", () => {
    expect(riskLevel("APPROVE", [])).toBe("LOW");
    expect(riskLevel("ESCALATE", [])).toBe("MEDIUM");
    expect(riskLevel("ABSTAIN", [])).toBe("MEDIUM");
    expect(riskLevel("REJECT", [{ code: "SCORE_ABOVE_REJECT" }])).toBe("HIGH");
    expect(riskLevel("REJECT", [{ code: "BLOCKER_SANCTIONS_FAIL" }])).toBe("CRITICAL");
  });
  it("never reports an abstain as low risk", () => {
    expect(riskScore("ABSTAIN", 0)).toBe(0.5);
    expect(riskScore("ABSTAIN", 8_000)).toBe(0.8);
    expect(riskScore("APPROVE", 1_200)).toBe(0.12);
  });
});

describe("signed verdicts", () => {
  it("signs every served verdict, and anyone can check it against the published attester", async () => {
    const v = await j(post(body));
    expect(v.attestation).toMatchObject({ scheme: "eip191", signer: ATTESTER });
    expect(v.attestation.message).toBe(attestationMessage(v));
    expect(v.attestation.message).toContain(`verdict_hash: ${v.verdictHash}`);
    expect(await verifyMessage({ address: ATTESTER, message: v.attestation.message, signature: v.attestation.signature })).toBe(true);
    // Deterministic: the same verdict read again carries the same signature, and a header with it.
    const res = await app.request(`/v1/verdicts/${v.id}`);
    expect(res.headers.get("x-skein-attestation")).toBe(v.attestation.signature);
    expect((await j(res)).attestation.signature).toBe(v.attestation.signature);
    // A changed field no longer matches the signature.
    const forged = attestationMessage({ ...v, verdict: v.verdict === "APPROVE" ? "REJECT" : "APPROVE" });
    expect(await verifyMessage({ address: ATTESTER, message: forged, signature: v.attestation.signature })).toBe(false);
  });

  it("verify reports the signature, and status publishes the attester", async () => {
    const v = await j(post(body));
    const r = await j(app.request("/v1/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: v.id }) }));
    expect(r.checks.attestation).toBe(true);
    expect(r.attester).toBe(ATTESTER);
    expect((await j(app.request("/v1/status"))).attester).toBe(ATTESTER);
  });

  it("the miner's answer carries the same proof, for a buyer to attach to a payment", async () => {
    const res = await app.request("/miner/verdict", { method: "POST", headers: { "content-type": "application/json", "x-skein-miner-key": MINER_KEY }, body: JSON.stringify({ subject: `base:${TOKEN}` }) });
    const out = await j(res);
    expect(out.attestation.signer).toBe(ATTESTER);
    expect(await verifyMessage({ address: ATTESTER, message: out.attestation.message, signature: out.attestation.signature })).toBe(true);
  });

  it("refuses a malformed attestation key at startup", () => {
    expect(() => configFromEnv({ SKEIN_ATTESTATION_KEY: "0x1234" })).toThrow(/SKEIN_ATTESTATION_KEY/);
  });
});

describe("verdict stability on /v1/ledger", () => {
  it("counts consecutive answered verdicts for one token and policy, and whether they agree", async () => {
    const t = `0x${"5a".repeat(20)}`;
    const base = { subjectChainId: 8453, subjectToken: t, policyId: "dex-list", policyVersion: "0.2.0", engineVersion: "0.3.0", verdictCode: 1, riskBps: 0, confidenceBps: 0, coverageBps: 0, reasons: [], openRisks: [], conflicts: [], summary: "", verdictHash: "0x", bomRoot: "0x", bomItems: 0, channel: "api", network: "eip155:11155111", upstreamUusdc: 0, priceUusdc: 0, durationMs: 1 };
    const rows = [["APPROVE", "2026-11-05T00:00:00Z"], ["APPROVE", "2026-11-06T00:00:00Z"], ["ABSTAIN", "2026-11-06T06:00:00Z"], ["ESCALATE", "2026-11-07T00:00:00Z"]] as const;
    for (const [i, [verdict, at]] of rows.entries()) {
      await service.deps.db.insert(schema.verdicts).values({ ...base, id: `vrd_stab${i}`, verdict, createdAt: new Date(at) } as never).catch((e: Error) => { throw new Error(`fixture insert: ${String((e as { cause?: unknown }).cause ?? e.message)}`); });
    }
    const l = await j(app.request("/v1/ledger"));
    // APPROVE → APPROVE agrees; APPROVE → ESCALATE does not; the ABSTAIN is skipped.
    expect(l.stability.byEngine).toContainEqual({ engine: "0.3.0", pairs: 2, same: 1, rate: 0.5 });
  });
});
