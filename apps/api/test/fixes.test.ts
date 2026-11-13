// Regression tests for the 2026-11-12 audit (apps/api): one describe per item.
import { schema, type Db } from "@skein/db";
import { attestationMessage } from "@skein/engine";
import { and, eq, like, sql } from "drizzle-orm";
import type { Context } from "hono";
import { verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { clientIp, createApp, refusalError, skeinDepth, walletState } from "../src/app";
import { configFromEnv, productionProblems } from "../src/config";
import { SharedRateLimiter } from "../src/limits";
import { MAX_EVENT_RAW_BYTES, pricingFor, publicPurchase, VerdictService } from "../src/service";
import { publishPolicies, snapshotCatalogue } from "../src/catalog";
import { simulatedApi } from "../src/simulated";

type Api = Awaited<ReturnType<typeof simulatedApi>>;
const ATTESTATION_KEY = `0x${"cd".repeat(32)}` as const;
const ATTESTER = privateKeyToAccount(ATTESTATION_KEY).address;
let n = 0;
const tok = (end = "a") => `0x${(++n + 8192).toString(16).padStart(39, "0")}${end}`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = async (r: Response | Promise<Response>): Promise<any> => (await r).json();

let api: Api;
beforeAll(async () => {
  api = await simulatedApi({ fast: true, env: {}, config: { minerAuthKey: "mk", attestationKey: ATTESTATION_KEY } });
});
afterEach(() => {
  walletState.setEscrow(null);
});

const post = (a: Api, body: unknown, key: string = crypto.randomUUID()) =>
  a.app.request("/v1/verdicts", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${a.key}`, "idempotency-key": key, "x-forwarded-for": `192.0.2.${n % 250}` },
    body: JSON.stringify(body),
  });
const minerPost = (a: Api, b: unknown, h: Record<string, string> = {}) =>
  a.app.request("/miner/verdict", { method: "POST", headers: { "content-type": "application/json", "x-skein-miner-key": "mk", ...h }, body: JSON.stringify(b) });
const verify = (a: Api, id: string) => j(a.app.request("/v1/verify", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `198.18.0.${n++ % 250}` }, body: JSON.stringify({ id }) }));

describe("H6: attestations are signed at seal and stored", () => {
  it("stores the signature when the verdict is sealed, and serves that one", async () => {
    const v = await j(post(api, { subject: { chainId: 8453, token: tok() } }));
    const [row] = await api.db.select().from(schema.verdictAttestations).where(eq(schema.verdictAttestations.verdictId, v.id));
    expect(row).toMatchObject({ atSeal: true, signer: ATTESTER, message: attestationMessage(v), signature: v.attestation.signature });
    expect(v.attestation).toMatchObject({ atSeal: true, signedAt: row!.signedAt.toISOString() });
    expect(await verifyMessage({ address: ATTESTER, message: v.attestation.message, signature: v.attestation.signature })).toBe(true);
  });

  it("signs a verdict sealed before signatures were stored once, on first read, and says so", async () => {
    const v = await j(post(api, { subject: { chainId: 8453, token: tok() } }));
    // A legacy verdict: the same row under a new id, with no stored signature.
    const [row] = await api.db.select().from(schema.verdicts).where(eq(schema.verdicts.id, v.id));
    await api.db.insert(schema.verdicts).values({ ...row!, id: `${v.id}l`, consumerId: null, idempotencyKey: null });
    const first = await j(api.app.request(`/v1/verdicts/${v.id}l`));
    expect(first.attestation).toMatchObject({ atSeal: false, signer: ATTESTER });
    const again = await j(api.app.request(`/v1/verdicts/${v.id}l`));
    expect(again.attestation).toEqual(first.attestation);
    expect((await api.db.select().from(schema.verdictAttestations).where(eq(schema.verdictAttestations.verdictId, `${v.id}l`))).length).toBe(1);
  });

  it("verify checks the stored signature against the verdict as stored, and returns everything needed to recompute", async () => {
    const v = await j(post(api, { subject: { chainId: 8453, token: tok() } }));
    const r = await verify(api, v.id);
    expect(r.ok).toBe(true);
    expect(r.checks).toMatchObject({ attestation: true, attestationSignature: true, attestationMatchesVerdict: true, attestationSigner: true, signals: true, decisionMatches: true, receiptsMatch: true, policyFile: true, verdictHashRecomputes: true, bomRootRebuilt: true });
    expect(r).toMatchObject({ attester: ATTESTER, publishedAttester: ATTESTER, attestation: { atSeal: true }, policy: { ref: expect.stringMatching(/^dex-list@/), sha256: expect.any(String) } });
    expect(r.inputs).toMatchObject({ verdictHash: v.verdictHash, bomRoot: v.bom.root, findings: expect.any(Array), purchases: expect.any(Array) });

    // A stored signature over a message the verdict no longer produces is reported, and fails verification.
    const [row] = await api.db.select().from(schema.verdicts).where(eq(schema.verdicts.id, v.id));
    await api.db.insert(schema.verdicts).values({ ...row!, id: `${v.id}t`, consumerId: null, idempotencyKey: null });
    const signer = privateKeyToAccount(ATTESTATION_KEY);
    const stale = attestationMessage({ ...v, id: `${v.id}t`, verdict: "REJECT" });
    await api.db.insert(schema.verdictAttestations).values({ verdictId: `${v.id}t`, scheme: "eip191", signer: ATTESTER, message: stale, signature: await signer.signMessage({ message: stale }), atSeal: true });
    const t = await verify(api, `${v.id}t`);
    expect(t.ok).toBe(false);
    expect(t.checks).toMatchObject({ attestationSignature: true, attestationMatchesVerdict: false, attestation: false });
    expect(t.problems).toContain("the stored attestation does not sign the verdict as stored now");
  });
});

describe("M7: idempotency keys", () => {
  it("a transient refusal does not hold the key: the retry with the same key runs", async () => {
    const body = { subject: { chainId: 8453, token: tok() } };
    walletState.setEscrow(0);
    const first = await post(api, body, "m7-transient");
    expect(first.status).toBe(503);
    expect((await j(first)).error.code).toBe("WALLET_EMPTY");
    walletState.setEscrow(null);
    const retry = await post(api, body, "m7-transient");
    expect(retry.status).toBe(200);
    const again = await post(api, body, "m7-transient");
    expect((await j(again)).replayed).toBe(true);
  });

  it("a key expires after 24 hours: then it may carry a new request", async () => {
    const [c] = await api.db.select().from(schema.consumers).where(eq(schema.consumers.name, "local dev"));
    await api.db.insert(schema.verdictRuns).values({ id: "vrd_m7_old", consumerId: c!.id, idempotencyKey: "m7-old", requestHash: "another body", channel: "api", subjectChainId: 8453, subjectToken: tok(), policyId: "dex-list", policyVersion: "0.2.0", contextHash: "x", status: "done", verdictId: "vrd_m7_old", startedAt: new Date(Date.now() - 25 * 3_600_000) });
    const res = await post(api, { subject: { chainId: 8453, token: tok() } }, "m7-old");
    expect(res.status).toBe(200);
    // Within the window, a different body is still a conflict.
    expect((await post(api, { subject: { chainId: 8453, token: tok() } }, "m7-old")).status).toBe(409);
  });
});

describe("M8: event streams of runs with no events of their own", () => {
  it("ends a run served from another verdict with done, not error", async () => {
    const v = await j(post(api, { subject: { chainId: 8453, token: tok() } }));
    await api.db.insert(schema.verdictRuns).values({ id: "vrd_m8_cached", channel: "api", subjectChainId: 8453, subjectToken: v.subject.token, policyId: "dex-list", policyVersion: "0.2.0", contextHash: "x", status: "done", verdictId: v.id });
    const text = await (await api.app.request("/v1/verdicts/vrd_m8_cached/events")).text();
    expect(text).toContain("event: done");
    expect(text).toContain(`"servedFrom":"${v.id}"`);
    expect(text).not.toContain("event: error");
  });

  it("a client that connects before another replica records the first event gets the stream, and no error after it", async () => {
    await api.db.insert(schema.verdictRuns).values({ id: "vrd_m8_late", channel: "api", subjectChainId: 8453, subjectToken: tok(), policyId: "dex-list", policyVersion: "0.2.0", contextHash: "x", status: "running" });
    const reading = Promise.resolve(api.app.request("/v1/verdicts/vrd_m8_late/events")).then((r) => r.text());
    await new Promise((r) => setTimeout(r, 100));
    await api.db.insert(schema.events).values([
      { verdictId: "vrd_m8_late", seq: 0, type: "plan", payload: {} },
      { verdictId: "vrd_m8_late", seq: 1, type: "done", payload: { id: "vrd_m8_late" } },
    ]);
    await api.db.update(schema.verdictRuns).set({ status: "done", verdictId: "vrd_m8_late" }).where(eq(schema.verdictRuns.id, "vrd_m8_late"));
    const text = await reading;
    expect(text).toContain("event: plan");
    expect(text).toContain("event: done");
    expect(text).not.toContain("event: error");
  });
});

describe("M9: revenue per channel", () => {
  it("prices Telegraph answers at the floor, ABSTAIN included, and direct ABSTAINs at upstream cost", () => {
    expect(pricingFor("telegraph", "ABSTAIN", 40_000, 250_000)).toEqual({ priceUusdc: 250_000, rule: "telegraph_floor" });
    expect(pricingFor("api", "ABSTAIN", 40_000, 250_000)).toEqual({ priceUusdc: 40_000, rule: "abstain_upstream_only" });
    expect(pricingFor("api", "APPROVE", 40_000, 250_000)).toEqual({ priceUusdc: 250_000, rule: "standard" });
  });

  it("records revenue owed for every answered miner call: fresh, cached, and ABSTAIN answers alike", async () => {
    const owed = async () => (await api.db.select().from(schema.spendLedger).where(eq(schema.spendLedger.kind, "revenue_owed"))).length;
    const t = tok();
    const before = await owed();
    const fresh = await j(minerPost(api, { token: t, chain: "base" }));
    const cached = await j(minerPost(api, { token: t, chain: "base" }));
    expect(cached.cached).toBe(true);
    const loop = await j(minerPost(api, { token: tok(), chain: "base" }, { "x-skein-depth": "1" }));
    expect(loop.verdict).toBe("ABSTAIN");
    expect(fresh.verdict).not.toBe("ABSTAIN");
    expect((await owed()) - before).toBe(3);
  });
});

describe("M10: one purchase for identical concurrent requests", () => {
  it("N requests with different keys for the same verdict buy it once and all get it", async () => {
    const t = tok();
    const before = api.node.charges.length;
    const outs = await Promise.all(Array.from({ length: 4 }, () => post(api, { subject: { chainId: 8453, token: t } })));
    expect(outs.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const ids = new Set((await Promise.all(outs.map(j))).map((v) => v.id));
    expect(ids.size).toBe(1);
    const bought = await api.db.select().from(schema.verdicts).where(eq(schema.verdicts.subjectToken, t));
    expect(bought).toHaveLength(1);
    const perVerdict = (await api.db.select().from(schema.purchases).where(eq(schema.purchases.verdictId, bought[0]!.id))).filter((p) => p.amountUusdc > 0).length;
    expect(api.node.charges.length - before).toBe(perVerdict);
  });
});

describe("M11: the loop guard", () => {
  it("answers a request at skein-depth >= 1 from cache only, and never buys for it", async () => {
    for (const [b, h] of [[{ token: tok(), chain: "base" }, { "x-skein-depth": "1" }], [{ params: { token: tok(), chain: "base" }, context: { "skein-depth": "2" } }, {}]] as const) {
      const token = "params" in b ? b.params.token : b.token;
      const out = await j(minerPost(api, b, h));
      expect(out).toMatchObject({ verdict: "ABSTAIN", reasons: [{ code: "LOOP_GUARD" }] });
      expect(await api.db.select().from(schema.verdictRuns).where(eq(schema.verdictRuns.subjectToken, token))).toHaveLength(0);
    }
    expect(skeinDepth(undefined, { params: { "skein-depth": 1 } }, { "skein-depth": 1 })).toBe(1);
    expect(skeinDepth("0", {})).toBe(0);
  });

  it("refuses to start in production without Skein's own miner ids", () => {
    const cfg = configFromEnv({});
    expect(productionProblems({ RAILWAY_ENVIRONMENT_NAME: "production" }, cfg)).toEqual([expect.stringMatching(/SKEIN_SELF_REGISTRATION_IDS/)]);
    expect(productionProblems({ NODE_ENV: "production" }, cfg)).toHaveLength(1);
    expect(productionProblems({ NODE_ENV: "production" }, configFromEnv({ SKEIN_SELF_REGISTRATION_IDS: "845301,5137" }))).toEqual([]);
    expect(productionProblems({ NODE_ENV: "test" }, cfg)).toEqual([]);
  });
});

describe("M12: pipeline failures are tracked", () => {
  it("a run that throws reaches error_log and error tracking", async () => {
    const own = await simulatedApi({ fast: true, env: {} });
    const captured: unknown[] = [];
    const svc = new VerdictService({ ...own.service.deps, errors: { capture: async (e) => (captured.push(e), true) } });
    Object.defineProperty(svc, "catalogue", { get: () => { throw new Error("catalogue exploded"); }, set: () => {} });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createApp(svc).request("/v1/verdicts", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${own.key}`, "idempotency-key": "m12" }, body: JSON.stringify({ subject: { chainId: 8453, token: tok() } }) });
    expect(res.status).toBe(503);
    expect((await j(res)).error.code).toBe("VERDICT_FAILED");
    const rows = await own.db.select().from(schema.errorLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ route: "run api", message: expect.stringContaining("catalogue exploded") });
    expect(captured).toHaveLength(1);
  });
});

describe("spec §6 and §8 gaps", () => {
  it("a sync request that runs out of time answers 202 with the id, and the verdict is there later", async () => {
    // Not fast: the simulated miners take 0.3-3.5 s, well past a 100 ms sync window.
    const slow = await simulatedApi({ fast: false, env: {}, config: { syncTimeoutMs: 100 } });
    const res = await post(slow, { subject: { chainId: 8453, token: tok() } });
    expect(res.status).toBe(202);
    const body = await j(res);
    expect(body).toMatchObject({ status: "running", timedOut: true, events: `/v1/verdicts/${body.id}/events` });
    await slow.service.running.get(body.id);
    expect((await slow.app.request(`/v1/verdicts/${body.id}`)).status).toBe(200);
  });

  it("refuses a subject that is not a contract where an RPC can tell, and skips the check when it cannot", async () => {
    const empty = tok();
    const own = await simulatedApi({ fast: true, env: {} });
    const app = createApp(new VerdictService({ ...own.service.deps, getCode: async (_c, a) => (a === empty ? "0x" : a.endsWith("e") ? Promise.reject(new Error("rpc down")) : "0x6080") }));
    const req = (token: string) => app.request("/v1/verdicts", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${own.key}`, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ subject: { chainId: 8453, token } }) });
    const res = await req(empty);
    expect(res.status).toBe(400);
    expect((await j(res)).error).toMatchObject({ code: "INVALID_SUBJECT", message: expect.stringMatching(/not a contract/) });
    expect((await req(tok("e"))).status).toBe(200);
    expect((await req(tok())).status).toBe(200);
  });

  it("the miner's answer carries the hash headers and the disclaimer", async () => {
    const res = await minerPost(api, { token: tok(), chain: "base" });
    const out = await j(res);
    expect(res.headers.get("x-skein-verdict-hash")).toBe(out.verdict_hash);
    expect(res.headers.get("x-skein-bom-root")).toBe(out.bom_root);
    expect(out.disclaimer).toBe("Risk evidence, not investment advice.");
  });

  it("pauses uncached verdicts while the purchaser's escrow is empty, and says so in /v1/status", async () => {
    walletState.setEscrow(0);
    const res = await post(api, { subject: { chainId: 8453, token: tok() } });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("600");
    expect((await j(res)).error.code).toBe("WALLET_EMPTY");
    expect(await j(minerPost(api, { token: tok(), chain: "base" }))).toMatchObject({ verdict: "ABSTAIN", reasons: [{ code: "WALLET_EMPTY" }] });
    expect(await j(api.app.request("/v1/status", { headers: { "x-forwarded-for": "203.0.113.50" } }))).toMatchObject({ paused: true, pausedReason: expect.stringMatching(/escrow/) });
  });

  it("stops buying at 80% of the daily cap (spec §8), not at 100%", async () => {
    const capped = await simulatedApi({ fast: true, env: {}, config: { dailyCapUusdc: 1_000_000, perVerdictCapUusdc: 200_000 } });
    expect(capped.config.stopAtUusdc).toBe(800_000);
    await capped.db.insert(schema.spendHolds).values({ day: new Date().toISOString().slice(0, 10), runId: "x", channel: "api", reservedUusdc: 700_000 });
    const res = await post(capped, { subject: { chainId: 8453, token: tok() } });
    expect(res.status).toBe(503);
    expect((await j(res)).error.code).toBe("DAILY_CAP_REACHED");
    expect(configFromEnv({ DAILY_CAP_USDC: "10", GLOBAL_CAP_STOP_PCT: "100" }).stopAtUusdc).toBe(10_000_000);
  });

  it("a margin-guard refusal says it is that ABSTAIN", () => {
    const e = refusalError({ code: "MARGIN_GUARD", detail: "upstream over 80% of the price", checks: [], quoteUusdc: 230_000 });
    expect(e.details).toMatchObject({ verdict: "ABSTAIN", reasons: [{ code: "MARGIN_GUARD" }] });
  });
});

describe("hardening (audit, Low)", () => {
  it("public events carry a raw answer up to 8 KB, and its size and hash beyond", () => {
    const small = { check: "x", rawResult: { a: 1 } };
    expect(publicPurchase(small)).toBe(small);
    const big = publicPurchase({ check: "x", rawResult: { blob: "z".repeat(MAX_EVENT_RAW_BYTES) } });
    expect(big.rawResult).toMatchObject({ truncated: true, bytes: expect.any(Number), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it("/readyz answers 503 on a database failure without raising the unhandled-error alert", async () => {
    const raised: string[] = [];
    const broken = new Proxy(api.db, { get: (t, p) => (p === "execute" ? () => Promise.reject(new Error("db down")) : Reflect.get(t, p)) }) as Db;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = createApp(new VerdictService({ ...api.service.deps, db: broken, alerts: { raise: async (k) => (raised.push(k), true) } }));
    const res = await app.request("/readyz");
    expect(res.status).toBe(503);
    expect(await j(res)).toMatchObject({ ok: false, database: false });
    expect(raised).toEqual([]);
  });

  it("reads the client address from a Railway-shaped X-Forwarded-For (one trusted hop)", () => {
    const ctx = (xff: string | undefined) => ({ req: { header: (h: string) => (h === "x-forwarded-for" ? xff : undefined) } }) as unknown as Context;
    // The client forged two entries; Railway's edge appended the address it accepted the connection from.
    expect(clientIp(ctx("10.0.0.1, 1.2.3.4, 203.0.113.7"), 1)).toBe("203.0.113.7");
    expect(clientIp(ctx("203.0.113.7"), 1)).toBe("203.0.113.7");
    expect(clientIp(ctx(undefined), 1)).toBe("direct");
  });

  it("rate limits fail open for reads and closed for paid requests when the store is down, and a local bucket spares the database", async () => {
    let calls = 0;
    const down = { execute: async () => { calls++; throw new Error("db down"); } } as unknown as Db;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await new SharedRateLimiter(down, "read", 10).take("k")).toBeNull();
    expect(await new SharedRateLimiter(down, "paid", 10, { failClosed: true }).take("k")).toBe(5);
    const up = { execute: async () => { calls++; return { rows: [{ tokens: 1, allowed: true }] }; } } as unknown as Db;
    const l = new SharedRateLimiter(up, "burst", 2);
    calls = 0;
    expect(await l.take("ip")).toBeNull();
    expect(await l.take("ip")).toBeNull();
    expect(await l.take("ip")).toBeGreaterThan(0);
    expect(calls).toBe(2); // the third was refused locally
  });

  it("links each finding to the purchase whose receipt it cites", async () => {
    const v = await j(post(api, { subject: { chainId: 8453, token: tok() } }));
    const fs = await api.db.select().from(schema.findings).where(and(eq(schema.findings.verdictId, v.id), sql`${schema.findings.purchaseId} is not null`));
    expect(fs.length).toBeGreaterThan(0);
    const ps = await api.db.select().from(schema.purchases).where(like(schema.purchases.verdictId, v.id));
    for (const f of fs) expect(ps.find((p) => p.id === f.purchaseId)?.receiptHash).toBe((f.evidence as { receiptHash: string }).receiptHash);
  });

  it("writes the catalogue, intent health and policies into their tables, as the runtime role", async () => {
    const r = await snapshotCatalogue(api.db, api.service.catalogue);
    expect(r.miners).toBeGreaterThan(0);
    const miners = await api.db.select().from(schema.minerCatalog);
    expect(miners.length).toBe(r.miners);
    expect(miners[0]).toMatchObject({ slug: expect.any(String), intents: expect.any(Array), sourceGroup: expect.any(String) });
    const intents = await api.db.select().from(schema.intentStatus);
    expect(intents.length).toBe(r.intents);
    expect(intents.some((i) => i.minerCount > 0 && i.p95Ms !== null)).toBe(true);
    // Again: updated in place, not duplicated.
    await snapshotCatalogue(api.db, api.service.catalogue);
    expect((await api.db.select().from(schema.minerCatalog)).length).toBe(r.miners);
    const published = await publishPolicies(api.db);
    expect(published).toBeGreaterThan(0);
    expect(await publishPolicies(api.db)).toBe(0);
  });
});

describe("engine 0.4.0 integration", () => {
  it("answers a Telegraph call whose required check no miner Skein buys from can answer with an ABSTAIN that bought nothing, and the quote agrees", async () => {
    const own = await simulatedApi({ fast: true, env: {}, config: { minerAuthKey: "mk" } });
    const catalogue = { ...own.service.catalogue, minersByIntent: { ...own.service.catalogue.minersByIntent, SANCTIONS_SCREENING_MATCH_GENERAL: [] } };
    const app = createApp(new VerdictService({ ...own.service.deps, catalogue }));
    const t = tok();
    const before = own.node.charges.length;
    const out = await j(app.request("/miner/verdict", { method: "POST", headers: { "content-type": "application/json", "x-skein-miner-key": "mk" }, body: JSON.stringify({ token: t, chain: "base" }) }));
    expect(out).toMatchObject({ verdict: "ABSTAIN", reasons: [{ code: "UPSTREAM_UNAVAILABLE" }], upstream_usdc: 0, checks: ["sanctions"] });
    expect(own.node.charges.length).toBe(before);
    const q = await j(app.request(`/v1/quote?chain=8453&token=${t}&policy=dex-list`));
    expect(q).toMatchObject({ ok: false, refusal: { code: "UPSTREAM_UNAVAILABLE" } });
  });

  it("records a Telegraph caller's request_id with its answer, for a caller that lost the connection (H9)", async () => {
    const rid = crypto.randomUUID();
    const out = await j(minerPost(api, { params: { token: tok(), chain: "base", request_id: rid } }));
    const r = await j(api.app.request(`/v1/miner/requests/${rid}`));
    expect(r).toMatchObject({ requestId: rid, status: "answered", verdictId: out.id, verdict: `/v1/verdicts/${out.id}` });
    // A later ABSTAIN under the same id never loses the verdict.
    await j(minerPost(api, { token: tok(), chain: "base", request_id: rid }, { "x-skein-depth": "1" }));
    expect((await j(api.app.request(`/v1/miner/requests/${rid}`))).verdictId).toBe(out.id);
    expect((await minerPost(api, { token: tok(), chain: "base", request_id: "short" })).status).toBe(400);
    expect((await api.app.request("/v1/miner/requests/short")).status).toBe(400);
    expect((await api.app.request(`/v1/miner/requests/${crypto.randomUUID()}`)).status).toBe(404);
  });

  it("follows a request answered DEADLINE until its verdict is sealed", async () => {
    const rid = crypto.randomUUID();
    const v = await j(post(api, { subject: { chainId: 8453, token: tok() } }));
    await api.db.insert(schema.verdictRuns).values({ id: "vrd_h9_run", channel: "telegraph", subjectChainId: 8453, subjectToken: tok(), policyId: "dex-list", policyVersion: "0.2.0", contextHash: "x", status: "running" });
    await api.db.insert(schema.minerRequests).values({ requestId: rid, runId: "vrd_h9_run", code: "DEADLINE" });
    expect(await j(api.app.request(`/v1/miner/requests/${rid}`))).toMatchObject({ status: "pending", verdictId: null, code: "DEADLINE" });
    await api.db.update(schema.verdictRuns).set({ status: "done", verdictId: v.id }).where(eq(schema.verdictRuns.id, "vrd_h9_run"));
    expect(await j(api.app.request(`/v1/miner/requests/${rid}`))).toMatchObject({ status: "answered", verdictId: v.id });
  });

  it("seals simulated verdicts as simulated, verifies them as such, and shows every reproduce problem as a check", async () => {
    const v = await j(post(api, { subject: { chainId: 8453, token: tok() } }));
    const [row] = await api.db.select({ network: schema.verdicts.network }).from(schema.verdicts).where(eq(schema.verdicts.id, v.id));
    expect(row!.network).toBe("simulated");
    const r = await verify(api, v.id);
    expect(r.inputs.mode).toBe("simulated");
    expect(r.ok).toBe(true);
    expect(r.checks).toMatchObject({ unpurchased: true, reproduces: true });
  });

  it("publishes the OFAC snapshot's age and staleness at /v1/status", async () => {
    const s = await j(api.app.request("/v1/status", { headers: { "x-forwarded-for": "203.0.113.77" } }));
    expect(s.ofacSnapshot).toMatchObject({ fetched: expect.any(String), ageDays: expect.any(Number), maxAgeDays: expect.any(Number), stale: expect.any(Boolean) });
  });
});
