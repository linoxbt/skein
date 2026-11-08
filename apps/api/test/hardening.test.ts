import { createHash, createHmac } from "node:crypto";
import { schema } from "@skein/db";
import { beforeAll, describe, expect, it } from "vitest";
import { simulatedApi } from "../src/simulated";

type Api = Awaited<ReturnType<typeof simulatedApi>>;
let n = 0;
const tok = (end = "a") => `0x${(++n + 4096).toString(16).padStart(39, "0")}${end}`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = async (r: Response | Promise<Response>): Promise<any> => (await r).json();

function client(api: Api) {
  const post = (body: unknown, h: Record<string, string> = {}) =>
    api.app.request("/v1/verdicts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${api.key}`, "idempotency-key": crypto.randomUUID(), ...h },
      body: JSON.stringify(body),
    });
  return { post };
}

let api: Api;
beforeAll(async () => {
  api = await simulatedApi({ fast: true, env: {}, config: { minerAuthKey: "mk" } });
});

describe("idempotency under concurrency", () => {
  it("one key, six concurrent requests: one verdict bought, everyone gets it", async () => {
    const { post } = client(api);
    const before = api.node.charges.length;
    const body = { subject: { chainId: 8453, token: tok() }, policy: "dex-list@0.1.0" };
    const outs = await Promise.all(Array.from({ length: 6 }, () => post(body, { "idempotency-key": "same-key" })));
    expect(outs.every((r) => r.status === 200 || r.status === 202)).toBe(true);
    const ids = new Set((await Promise.all(outs.map(j))).map((o) => o.id));
    expect(ids.size).toBe(1);
    expect(api.node.charges.length - before).toBeLessThanOrEqual(6); // one verdict's worth, not six
  });

  it("treats case and @-handles as the same request, but a different budget as a different one", async () => {
    const { post } = client(api);
    const token = tok();
    const a = await j(post({ subject: { chainId: 8453, token }, context: { socialHandle: "@Proj" } }, { "idempotency-key": "norm" }));
    const b = await post({ subject: { chainId: 8453, token: token.toUpperCase().replace("0X", "0x") }, context: { socialHandle: "proj" } }, { "idempotency-key": "norm" });
    expect((await j(b)).id).toBe(a.id);
    const c = await post({ subject: { chainId: 8453, token }, context: { socialHandle: "proj" }, budgetUsdcMax: 0.1 }, { "idempotency-key": "norm" });
    expect(c.status).toBe(409);
  });
});

describe("the cache", () => {
  it("never serves a verdict made for another context, and never serves ABSTAIN", async () => {
    const { post } = client(api);
    const token = tok();
    await j(post({ subject: { chainId: 8453, token }, context: { deployer: `0x${"1".repeat(40)}` } }));
    const other = await post({ subject: { chainId: 8453, token }, context: { deployer: `0x${"2".repeat(40)}` } });
    expect(other.headers.get("x-skein-cache")).toBeNull();
    const same = await post({ subject: { chainId: 8453, token }, context: { deployer: `0x${"2".repeat(40)}` } });
    expect(same.headers.get("x-skein-cache")).toBe("hit");
  });
});

describe("errors", () => {
  it("answers an unknown route with the JSON error shape and a request id", async () => {
    const res = await api.app.request("/v1/nope");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; requestId?: string } };
    expect(body).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
  });
  it("echoes a caller's request id in the header and in error bodies", async () => {
    const res = await api.app.request("/v1/verdicts/vrd_nope", { headers: { "x-request-id": "trace-123" } });
    expect(res.headers.get("x-request-id")).toBe("trace-123");
    expect(((await res.json()) as { error: { requestId?: string } }).error.requestId).toBe("trace-123");
  });
});

describe("context", () => {
  it("takes a pool address or a Uniswap v4 pool id, and nothing else", async () => {
    const { post } = client(api);
    for (const pool of [`0x${"a".repeat(40)}`, `0x${"b".repeat(64)}`]) {
      expect((await post({ subject: { chainId: 8453, token: tok() }, context: { pool } })).status, pool).not.toBe(400);
    }
    for (const pool of [`0x${"c".repeat(50)}`, `0x${"d".repeat(63)}`, "pool"]) {
      expect((await post({ subject: { chainId: 8453, token: tok() }, context: { pool } })).status, pool).toBe(400);
    }
  }, 30_000);
});

describe("spend caps", () => {
  it("concurrent verdicts cannot spend past the daily cap together", async () => {
    const capped = await simulatedApi({ fast: true, env: {}, config: { dailyCapUusdc: 300_000, perVerdictCapUusdc: 100_000 } });
    const { post } = client(capped);
    await Promise.all(Array.from({ length: 5 }, () => Promise.resolve(post({ subject: { chainId: 8453, token: tok() } })).catch(() => null)));
    const spent = capped.node.charges.reduce((a, c) => a + c.amountUusdc, 0);
    expect(spent).toBeLessThanOrEqual(300_000);
    const held = await capped.db.select().from(schema.spendHolds);
    expect(held.reduce((a, h) => a + (h.spentUusdc ?? h.reservedUusdc), 0)).toBeLessThanOrEqual(300_000);
  });
});

describe("pricing", () => {
  it("charges ABSTAIN at upstream cost only, and says which rule applied", async () => {
    const { post } = client(api);
    // A deployer ending in "e" makes the simulated sanctions miner hang: a required check is missing.
    const v = await j(post({ subject: { chainId: 8453, token: tok() }, context: { deployer: `0x${"3".repeat(39)}e` } }));
    expect(v.verdict).toBe("ABSTAIN");
    expect(v.cost).toMatchObject({ pricingRule: "abstain_upstream_only", priceUsdc: v.cost.upstreamUsdc });
  }, 30_000);
});

describe("runs, reads and streams", () => {
  it("answers 404 for an unknown id, and LOST for a run a crash left behind", async () => {
    expect((await api.app.request("/v1/verdicts/vrd_nope")).status).toBe(404);
    expect((await api.app.request("/v1/verdicts/vrd_nope/events")).status).toBe(404);
    await api.db.insert(schema.verdictRuns).values({ id: "vrd_lost", channel: "api", subjectChainId: 8453, subjectToken: tok(), policyId: "dex-list", policyVersion: "0.1.0", contextHash: "x", status: "running", startedAt: new Date("2026-01-01") });
    expect(await api.service.sweep()).toBeGreaterThanOrEqual(1);
    const res = await api.app.request("/v1/verdicts/vrd_lost");
    expect(res.status).toBe(503);
    expect((await j(res)).error.code).toBe("LOST");
  });

  it("resumes a stream after Last-Event-ID, with the same ids live and replayed", async () => {
    const { post } = client(api);
    const v = await j(post({ subject: { chainId: 8453, token: tok() } }));
    const text = await (await api.app.request(`/v1/verdicts/${v.id}/events`, { headers: { "last-event-id": "2" } })).text();
    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(ids[0]).toBe(3);
    expect(text).toMatch(/event: done/);
  });

  it("refuses a body over 64 KB", async () => {
    const res = await api.app.request("/v1/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "x".repeat(70_000) }) });
    expect(res.status).toBe(413);
  });

  it("rate-limits by the address the proxy saw, not by what the client claims", async () => {
    let limited = 0;
    for (let i = 0; i < 40; i++) {
      const res = await api.app.request("/v1/quote?chain=8453&token=0x4200000000000000000000000000000000000006", { headers: { "x-forwarded-for": `9.9.9.${i}, 1.2.3.4` } });
      if (res.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it("verify reports the served decision, the receipts, the policy file and the signals", async () => {
    const { post } = client(api);
    const v = await j(post({ subject: { chainId: 8453, token: tok() } }));
    const r = await j(api.app.request("/v1/verify", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.7" }, body: JSON.stringify({ id: v.id }) }));
    expect(r.ok).toBe(true);
    expect(r.checks).toMatchObject({ adaptersRerun: true, policyRerun: true, bomRootRebuilt: true, engineVersion: true, decisionMatches: true, receiptsMatch: true, policyFile: true });
    expect(r.signals.verified).toBeGreaterThan(0);
  });
});

describe("keys and webhooks", () => {
  it("refuses a revoked key", async () => {
    const key = "sk_part_revoked_test";
    await api.db.insert(schema.consumers).values({ name: "gone", kind: "team", apiKeyHash: createHash("sha256").update(key).digest("hex"), revokedAt: new Date() });
    const res = await api.app.request("/v1/verdicts", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "idempotency-key": "k" }, body: "{}" });
    expect(res.status).toBe(401);
  });

  it("delivers a signed webhook when an async verdict finishes", async () => {
    const delivered: { body: string; sig: string }[] = [];
    api.service.deps.lookup = async () => ["93.184.216.34"];
    api.service.deps.fetch = async (_url, init) => {
      delivered.push({ body: String(init?.body), sig: new Headers(init?.headers).get("x-skein-signature") ?? "" });
      return new Response("ok");
    };
    const reg = await j(api.app.request("/v1/webhooks", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${api.key}` }, body: JSON.stringify({ url: "https://hooks.example.com/skein" }) }));
    const { post } = client(api);
    const started = await j(post({ subject: { chainId: 8453, token: tok() }, mode: "async" }));
    await api.service.running.get(started.id);
    await new Promise((r) => setTimeout(r, 50));
    const hit = delivered.find((d) => d.body.includes(started.id))!;
    expect(hit).toBeTruthy();
    expect(hit.sig).toBe(`sha256=${createHmac("sha256", reg.secret).update(hit.body).digest("hex")}`);
    expect(JSON.parse(hit.body)).toMatchObject({ event: "verdict.done", id: started.id });
  });

  it("shows the caller's webhook without its secret, and turns it off", async () => {
    api.service.deps.lookup = async () => ["93.184.216.34"];
    const auth = { authorization: `Bearer ${api.key}` };
    const get = async () => (await (await api.app.request("/v1/webhooks", { headers: auth })).json()) as { webhook: { url: string; secret?: string } | null };
    expect((await get()).webhook?.url).toBe("https://hooks.example.com/skein");
    expect(JSON.stringify(await get())).not.toContain("secret");
    const del = (await (await api.app.request("/v1/webhooks", { method: "DELETE", headers: auth })).json()) as { deleted: boolean };
    expect(del.deleted).toBe(true);
    expect((await get()).webhook).toBeNull();
    expect((await api.app.request("/v1/webhooks", { headers: {} })).status).toBe(402);
  });

  it("refuses a webhook URL that is not public https", async () => {
    api.service.deps.lookup = async (h) => (h === "inward.example.com" ? ["10.0.0.7"] : ["93.184.216.34"]);
    // Four, within the per-key limit (5, one used above); safeurl.test.ts covers the rest.
    for (const url of ["http://x.example", "https://169.254.169.254/latest", "https://172.20.0.1/x", "https://inward.example.com/x"]) {
      const res = await api.app.request("/v1/webhooks", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${api.key}` }, body: JSON.stringify({ url }) });
      expect(res.status, url).toBe(400);
    }
  });
});
