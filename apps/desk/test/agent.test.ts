import { simulatedApi } from "@skein/api/simulated";
import { Skein, type TelegraphAsker } from "@skeinlabs/sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { decide, InputError, parseApplication, process, receive, tick, type AgentDeps, type TelegraphSkein } from "../lib/agent";
import { memoryStore, type Store } from "../lib/store";
import type { Application } from "../lib/types";

/** Test helper: replace an application as stored (compare-and-swap on its current version). */
async function overwrite(store: Store, a: Application) {
  const cur = await store.get(a.id);
  if (!cur || !(await store.update(a, cur.etag))) throw new Error("overwrite failed");
}
import { columnOf } from "../lib/types";

let api: Awaited<ReturnType<typeof simulatedApi>>;
let n = 0;
const tok = (end = "a") => `0x${(++n).toString(16).padStart(39, "0")}${end}`;

beforeAll(async () => {
  api = await simulatedApi({ fast: true, env: {} });
});

function deps(o: Partial<AgentDeps> = {}): AgentDeps {
  const skein = new Skein({
    apiUrl: "http://skein.test",
    payer: { kind: "apiKey", key: api.key },
    fetch: (i, init) => Promise.resolve(api.app.fetch(new Request(String(i), init))),
  });
  return { store: memoryStore(), skein, rail: "apiKey", webUrl: "https://skein.test", waitMs: 10_000, ...o };
}

/** The Telegraph rail around a test asker, reading verdicts from the simulated API. */
const tg =
  (asker: TelegraphAsker, opts: { minerId?: string; fetchApi?: { app: { fetch: (r: Request) => Response | Promise<Response> } } } = {}): TelegraphSkein =>
  (wrap) =>
    new Skein({
      apiUrl: "http://skein.test",
      payer: { kind: "telegraph", client: wrap(asker), ...(opts.minerId ? { minerId: opts.minerId } : {}) },
      fetch: (i, init) => Promise.resolve((opts.fetchApi ?? api).app.fetch(new Request(String(i), init))),
    });

describe("the Desk agent", () => {
  it("shortlists a clean token", async () => {
    const d = deps();
    const app = await receive(d, { project: "Clean", chainId: 8453, token: tok() }, "form");
    const out = (await process(d, app.id))!;
    expect(out.status).toBe("decided");
    expect(out.decision).toMatchObject({ action: "shortlist", verdict: "APPROVE", rail: "apiKey", paidUsdc: 0, listPriceUsdc: 0.25 });
    expect(out.decision!.receipts).toBeGreaterThan(0);
    expect(out.decision!.letter).toMatch(/^Shortlisted: Clean/);
    expect(columnOf(out)).toBe("shortlist");
  });

  it("sends the conflict to the analyst queue with a brief", async () => {
    const d = deps();
    const app = await receive(d, { project: "Busy Market", chainId: 8453, token: tok("c") }, "webhook");
    const out = (await process(d, app.id))!;
    expect(out.decision).toMatchObject({ action: "analyst", verdict: "ESCALATE" });
    expect(out.decision!.letter).toMatch(/^Analyst brief: Busy Market/);
    expect(out.decision!.letter).toContain("wash_trading");
    expect(columnOf(out)).toBe("analyst");
  });

  it("never buys twice for one application", async () => {
    const d = deps();
    const app = await receive(d, { project: "Twice", chainId: 8453, token: tok() }, "form");
    const before = api.node.charges.length;
    const a = (await process(d, app.id))!;
    const after = api.node.charges.length;
    await overwrite(d.store, { ...a, status: "received", decision: undefined, verdictId: undefined });
    const b = (await process(d, app.id))!;
    expect(b.decision!.verdictId).toBe(a.decision!.verdictId);
    expect(api.node.charges.length).toBe(after);
    expect(after).toBeGreaterThan(before);
  });

  it("leaves a slow verdict open and settles it on the next tick", async () => {
    const d = deps({ waitMs: 50 });
    const app = await receive(d, { project: "Slow", chainId: 8453, token: tok(), deployer: `0x${"3".repeat(39)}e` }, "form");
    const first = (await process(d, app.id))!;
    expect(first.status).toBe("buying");
    expect(first.verdictId).toMatch(/^vrd_/);
    expect(columnOf(first)).toBe("incoming");
    const r = await tick({ ...d, waitMs: 60_000 }, 60_000);
    expect(r).toEqual({ open: 0, decided: 1 });
    const done = (await d.store.get(app.id))!.value;
    // The sanctions miner hangs: a required check is missing, so ABSTAIN goes to an analyst.
    expect(done.decision).toMatchObject({ action: "analyst", verdict: "ABSTAIN" });
  }, 70_000);

  it("hands a refusal to an analyst without a verdict", async () => {
    const d = deps();
    const app = await receive(d, { project: "Bad chain id", chainId: 8453, token: tok() }, "form");
    await overwrite(d.store, { ...app, subject: { chainId: 999, token: app.subject.token } });
    const out = (await process(d, app.id))!;
    expect(out.decision).toMatchObject({ action: "analyst", verdict: null, refusal: { code: "INVALID_SUBJECT" } });
    expect(out.decision!.letter).toMatch(/Nothing was decided automatically/);
  });

  it("waits, without deciding, when no Skein key is configured", async () => {
    const d = deps({ skein: null });
    const app = await receive(d, { project: "Offline", chainId: 1, token: tok() }, "form");
    expect((await process(d, app.id))!.status).toBe("received");
  });

  it("pays through Telegraph and records the receipt", async () => {
    const asker: TelegraphAsker = {
      ask: async (req) => {
        const res = await api.app.request("/v1/verdicts", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${api.key}`, "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({ subject: (req.params as { subject: unknown }).subject }),
        });
        const v = (await res.json()) as { id: string };
        return { ok: true, response: { miner_id: "skein", result: { id: v.id } }, receipt: { receipt_hash: `0x${"fe".repeat(32)}` }, amountUusdc: 150_000, durationMs: 5 };
      },
    };
    const d = deps({ telegraph: tg(asker), rail: "telegraph" });
    const app = await receive(d, { project: "Via Telegraph", chainId: 8453, token: tok() }, "webhook");
    const out = (await process(d, app.id))!;
    expect(out.decision).toMatchObject({ rail: "telegraph", paidUsdc: 0.15, billing: "paid", minerId: "skein", receiptHash: `0x${"fe".repeat(32)}`, action: "shortlist" });
    // The ask was recorded on the application before the verdict was read.
    expect(out.ask).toMatchObject({ billing: "paid", amountUsdc: 0.15, verdictId: out.decision!.verdictId });
  });

  it("does not re-ask a lost Telegraph call", async () => {
    let asks = 0;
    const asker: TelegraphAsker = { ask: async () => (asks++, { ok: false, kind: "timeout", error: "x" }) };
    const t0 = Date.parse("2026-11-10T10:00:00Z");
    const d = deps({ telegraph: tg(asker), rail: "telegraph", now: () => new Date(t0) });
    const app = await receive(d, { project: "Lost", chainId: 8453, token: tok() }, "form");
    await overwrite(d.store, { ...app, status: "buying", rail: "telegraph", startedAt: new Date(t0).toISOString() });
    expect((await process(d, app.id))!.status).toBe("buying");
    // Still within the longest a background run can last: perhaps in flight elsewhere.
    expect((await process({ ...d, now: () => new Date(t0 + 10 * 60_000) }, app.id))!.status).toBe("buying");
    const later = (await process({ ...d, now: () => new Date(t0 + 16 * 60_000) }, app.id))!;
    expect(later.decision).toMatchObject({ action: "analyst", rail: "telegraph", billing: "unknown", refusal: { code: "LOST_ASK" } });
    expect(asks).toBe(0);
  });
});

describe("applications", () => {
  it("validates input", () => {
    expect(() => parseApplication({ project: "", chainId: 8453, token: tok() })).toThrow(InputError);
    expect(() => parseApplication({ project: "x", chainId: 10, token: tok() })).toThrow(/chain/);
    expect(() => parseApplication({ project: "x", chainId: 8453, token: "0x12" })).toThrow(/token/);
    expect(() => parseApplication({ project: "x", chainId: 8453, token: tok(), repo: "https://evil.example/x" })).toThrow(/repo/);
    expect(parseApplication({ project: " Acme ", chainId: "1", token: tok(), social: "@acme" })).toMatchObject({ project: "Acme", subject: { chainId: 1 }, context: { social: "acme" } });
  });

  it("writes a decline letter that cites the reasons and the evidence", () => {
    const app = { id: "app_1", receivedAt: "2026-11-10T10:00:00.000Z", source: "form" as const, project: "Rug", subject: { chainId: 8453, token: tok() }, context: {}, status: "received" as const };
    const v = {
      id: "vrd_x", verdict: "REJECT", summary: "Rejected: sanctions match.", reasons: [{ code: "BLOCKER", detail: "sanctions: deployer is on a sanctions list" }],
      openRisks: [], cost: { upstreamUsdc: 0.05, priceUsdc: 0.25, currency: "USDC" }, bom: { root: "0x", items: 5 }, verdictHash: "0xabc", network: "testnet",
      policy: { id: "dex-list", version: "0.1.0" }, payment: { rail: "apiKey" },
    } as never;
    const d = decide(app, { verdict: v }, "https://skein.test", new Date("2026-11-10T10:00:04Z"));
    expect(d).toMatchObject({ action: "decline", seconds: 4 });
    expect(d.letter).toMatch(/^Dear Rug team,/);
    expect(d.letter).toContain("sanctions: deployer is on a sanctions list");
    expect(d.letter).toContain("https://skein.test/v/vrd_x");
  });
});

describe("concurrency (leases)", () => {
  it("five agents on one Telegraph application ask exactly once", async () => {
    let asks = 0;
    const asker: TelegraphAsker = {
      ask: async (req) => {
        asks++;
        await new Promise((r) => setTimeout(r, 30));
        const res = await api.app.request("/v1/verdicts", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${api.key}`, "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({ subject: (req.params as { subject: unknown }).subject }),
        });
        const v = (await res.json()) as { id: string };
        return { ok: true, response: { miner_id: "skein", result: { id: v.id } }, receipt: { receipt_hash: `0x${"cd".repeat(32)}` }, amountUusdc: 150_000, durationMs: 5 };
      },
    };
    const d = deps({ telegraph: tg(asker), rail: "telegraph" });
    const app = await receive(d, { project: "Crowded", chainId: 8453, token: tok() }, "form");
    await Promise.all(Array.from({ length: 5 }, () => process(d, app.id)));
    expect(asks).toBe(1);
    expect((await d.store.get(app.id))!.value.status).toBe("decided");
  });

  it("never rewrites a decision", async () => {
    const d = deps();
    const app = await receive(d, { project: "Once", chainId: 8453, token: tok() }, "form");
    const first = (await process(d, app.id))!;
    const again = await Promise.all(Array.from({ length: 3 }, () => process(d, app.id)));
    for (const a of again) expect(a!.decision).toEqual(first.decision);
  });

  it("takes intake slots atomically", async () => {
    const store = memoryStore();
    const got = await Promise.all(Array.from({ length: 20 }, () => store.take("day/x", 7)));
    expect(got.filter(Boolean)).toHaveLength(7);
  });

  it("keeps the board to one read of summaries, newest first, with no lease or letter", async () => {
    const d = deps();
    const a = await receive(d, { project: "First", chainId: 8453, token: tok() }, "form");
    await process(d, a.id);
    const b = await receive(d, { project: "Second", chainId: 8453, token: tok() }, "form");
    const list = await d.store.list();
    expect(list[0]!.id).toBe(b.id);
    expect(list.find((x) => x.id === a.id)!.decision?.action).toBe("shortlist");
    expect(JSON.stringify(list)).not.toMatch(/"lease"|"letter"/);
  });
});

describe("the Telegraph rail, end to end", () => {
  it("buys through a real Telegraph client and escrow signature, routed to Skein's miner endpoint", async () => {
    const { TelegraphClient, TESTNET, viemSigner } = await import("@skein/telegraph");
    const { FakeNode } = await import("@skein/telegraph/testing");
    const mined = await simulatedApi({ fast: true, env: {}, config: { minerAuthKey: "mk" } });
    const node = new FakeNode({
      priceUusdc: 150_000,
      respond: async (_minerId, body) => {
        const res = await mined.app.request("/miner/verdict", { method: "POST", headers: { "content-type": "application/json", "x-skein-miner-key": "mk" }, body: JSON.stringify(body.params) });
        return { kind: "answer", result: await res.json() };
      },
    });
    const client = new TelegraphClient({ network: TESTNET, signer: viemSigner(`0x${"66".repeat(32)}`), fetch: node.fetch, maxUusdcPerCall: 300_000, allowPreSeason: true });
    const d = deps({ skein: null, telegraph: tg(client, { minerId: "skein", fetchApi: mined }), rail: "telegraph" });
    const app = await receive(d, { project: "Real Rail", chainId: 8453, token: tok() }, "webhook");
    const out = (await process(d, app.id))!;
    expect(out.decision).toMatchObject({ rail: "telegraph", paidUsdc: 0.15, billing: "paid", action: "shortlist" });
    expect(out.decision!.receiptHash).toBe(node.charges[0]!.receiptHash);
    expect(node.charges).toHaveLength(1);
  });
});
