import { simulatedApi } from "@skein/api/simulated";
import { Skein, type TelegraphAsker } from "@skeinlabs/sdk";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MAX_UNPAID_ATTEMPTS, process, receive, tick, type AgentDeps, type TelegraphSkein } from "../lib/agent";
import { memoryStore, Store, summarise, type KV } from "../lib/store";
import type { Application } from "../lib/types";
import { subjectFromWire } from "./subject";

let api: Awaited<ReturnType<typeof simulatedApi>>;
let n = 0x700;
const tok = () => `0x${(++n).toString(16).padStart(40, "0")}`;
const RECEIPT = `0x${"ab".repeat(32)}`;

beforeAll(async () => {
  api = await simulatedApi({ fast: true, env: {} });
});

const apiFetch = (i: RequestInfo | URL, init?: RequestInit) => Promise.resolve(api.app.fetch(new Request(String(i), init)));

/** Buys a verdict on the simulated API, as Skein's miner would, and returns its id. */
async function mint(subject: unknown): Promise<string> {
  const res = await api.app.request("/v1/verdicts", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${api.key}`, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ subject: typeof subject === "string" ? subjectFromWire(subject) : subject }),
  });
  return ((await res.json()) as { id: string }).id;
}

const paidAnswer = (result: unknown) => ({ ok: true as const, response: { miner_id: "845301", result, signal_hash: `0x${"5a".repeat(32)}` }, receipt: { receipt_hash: RECEIPT }, amountUusdc: 150_000, durationMs: 5 });

/** A Telegraph asker that counts its asks and answers with `answer(callNo, params)`. */
function asker(answer: (call: number, params: Record<string, unknown>) => unknown) {
  const a = { asks: 0, client: null as unknown as TelegraphAsker };
  a.client = { ask: async (req) => answer(++a.asks, req.params ?? {}) as never };
  return a;
}

const tg =
  (client: TelegraphAsker, fetchImpl: typeof fetch = apiFetch): TelegraphSkein =>
  (wrap) =>
    new Skein({ apiUrl: "http://skein.test", payer: { kind: "telegraph", client: wrap(client), minerId: "845301" }, fetch: fetchImpl, retries: 0, timeoutMs: 5_000 });

function deps(o: Partial<AgentDeps> = {}): AgentDeps {
  return { store: memoryStore(), skein: null, rail: "telegraph", webUrl: "https://skein.test", waitMs: 10_000, telegraphFormDaily: 100, ...o };
}

const partner = () => new Skein({ apiUrl: "http://skein.test", payer: { kind: "apiKey", key: api.key }, fetch: apiFetch });

describe("H5: what a Telegraph ask cost is never lost", () => {
  it("records a paid ask that brought no verdict at its price and receipt, and never asks again", async () => {
    const a = asker(() => paidAnswer({ verdict: "ABSTAIN", reasons: [{ code: "BUDGET_TOO_LOW", detail: "out of budget" }] }));
    const d = deps({ telegraph: tg(a.client) });
    const app = await receive(d, { project: "Paid Nothing", chainId: 8453, token: tok() }, "agent");
    const out = (await process(d, app.id))!;
    expect(out.decision).toMatchObject({
      action: "analyst", verdict: null, rail: "telegraph", paidUsdc: 0.15, billing: "paid", receiptHash: RECEIPT, minerId: "845301",
      refusal: { code: "TELEGRAPH_NO_VERDICT" },
    });
    expect(out.decision!.letter).toMatch(/Paid: 0\.15 USDC, receipt 0xabab/);
    await process(d, app.id);
    await tick(d);
    expect(a.asks).toBe(1);
  });

  it("records a payment sent with no answer as billing unknown, with the amount signed", async () => {
    const a = asker(() => ({ ok: false, kind: "timeout", error: "paid request: timeout", paidUusdc: 150_000, billing: "unknown" }));
    const d = deps({ telegraph: tg(a.client) });
    const app = await receive(d, { project: "Maybe Paid", chainId: 8453, token: tok() }, "agent");
    const out = (await process(d, app.id))!;
    expect(out.decision).toMatchObject({ action: "analyst", rail: "telegraph", paidUsdc: 0.15, billing: "unknown", receiptHash: null });
    await tick(d);
    expect(a.asks).toBe(1);
  });

  it("treats an ask that throws as maybe paid: never asked again", async () => {
    const a = asker(() => {
      throw new Error("socket hang up");
    });
    const d = deps({ telegraph: tg(a.client) });
    const app = await receive(d, { project: "Threw", chainId: 8453, token: tok() }, "agent");
    expect((await process(d, app.id))!.decision).toMatchObject({ rail: "telegraph", billing: "unknown" });
    await tick(d);
    expect(a.asks).toBe(1);
  });

  it("retries an ask that failed before any payment on the next tick", async () => {
    const a = asker((call, params) => (call === 1 ? { ok: false, kind: "network", error: "unpaid request: network", paidUusdc: 0, billing: "none" } : mint(params.subject).then((id) => paidAnswer({ id }))));
    const d = deps({ telegraph: tg(a.client) });
    const app = await receive(d, { project: "Blip", chainId: 8453, token: tok() }, "agent");
    const first = (await process(d, app.id))!;
    expect(first).toMatchObject({ status: "received", rail: "telegraph", attempts: 1 });
    expect(first.decision).toBeUndefined();
    expect((await d.store.kv.get<{ code: string }>("agent/last_error"))?.value.code).toBe("TELEGRAPH_NETWORK");
    expect(await tick(d)).toEqual({ open: 0, decided: 1 });
    expect((await d.store.get(app.id))!.value.decision).toMatchObject({ rail: "telegraph", paidUsdc: 0.15, action: "shortlist" });
    expect(a.asks).toBe(2);
  });

  it("gives up on Telegraph after the unpaid attempts: the partner key buys it, or an analyst gets it", async () => {
    const refused = () => ({ ok: false, kind: "refused", error: "payment refused: insufficient escrow", httpStatus: 402, paidUusdc: 0, billing: "none" });
    for (const withPartner of [true, false]) {
      const a = asker(refused);
      const d = deps({ telegraph: tg(a.client), skein: withPartner ? partner() : null });
      const app = await receive(d, { project: "Empty Escrow", chainId: 8453, token: tok() }, "agent");
      for (let i = 0; i < MAX_UNPAID_ATTEMPTS; i++) expect((await process(d, app.id))!.status).toBe("received");
      const out = (await process(d, app.id))!;
      expect(a.asks).toBe(MAX_UNPAID_ATTEMPTS);
      expect(out.decision).toMatchObject(
        withPartner ? { rail: "apiKey", paidUsdc: 0, action: "shortlist" } : { rail: "none", paidUsdc: 0, action: "analyst", refusal: { code: "TELEGRAPH_UNAVAILABLE" } },
      );
    }
  });
});

describe("H9: a paid ask survives the function that made it", () => {
  it("recovers the verdict on a later tick when the function dies after the ask, without asking again", async () => {
    const t0 = Date.parse("2026-11-20T10:00:00Z");
    const a = asker((_c, params) => mint(params.subject).then((id) => paidAnswer({ id })));
    // The first run's verdict read never answers: the function is stopped there, after paying.
    const hang: typeof fetch = () => new Promise<Response>(() => {});
    const d = deps({ telegraph: tg(a.client, hang), now: () => new Date(t0) });
    const app = await receive(d, { project: "Cut Off", chainId: 8453, token: tok() }, "agent");
    void process(d, app.id);
    await vi.waitFor(async () => expect((await d.store.get(app.id))!.value.ask).toBeDefined());
    const mid = (await d.store.get(app.id))!.value;
    expect(mid).toMatchObject({ status: "buying", ask: { billing: "paid", amountUsdc: 0.15, receiptHash: RECEIPT, minerId: "845301" } });
    expect(mid.ask!.verdictId).toMatch(/^vrd_/);
    // Within the lease nobody touches it; after it, the next tick reads the verdict.
    const later = { ...d, telegraph: tg(a.client), now: () => new Date(t0 + 6 * 60_000) };
    expect((await process({ ...later, now: () => new Date(t0 + 60_000) }, app.id))!.status).toBe("buying");
    const out = (await process(later, app.id))!;
    expect(out.decision).toMatchObject({ rail: "telegraph", paidUsdc: 0.15, billing: "paid", receiptHash: RECEIPT, minerId: "845301", verdictId: mid.ask!.verdictId, action: "shortlist" });
    expect(a.asks).toBe(1);
  });

  it("keeps a paid ask whose verdict is still being made, and settles it from its pending id", async () => {
    let fail = true;
    const flaky: typeof fetch = (i, init) => (fail && String(i).includes("/v1/verdicts/") ? Promise.reject(new TypeError("fetch failed")) : apiFetch(i, init));
    const a = asker((_c, params) => mint(params.subject).then((id) => paidAnswer({ verdict: "ABSTAIN", pending_id: id })));
    const d = deps({ telegraph: tg(a.client, flaky) });
    const app = await receive(d, { project: "Pending", chainId: 8453, token: tok() }, "agent");
    const first = (await process(d, app.id))!;
    expect(first).toMatchObject({ status: "buying", ask: { billing: "paid" } });
    expect(first.decision).toBeUndefined();
    fail = false;
    expect(await tick(d)).toEqual({ open: 0, decided: 1 });
    expect((await d.store.get(app.id))!.value.decision).toMatchObject({ rail: "telegraph", paidUsdc: 0.15, action: "shortlist" });
    expect(a.asks).toBe(1);
  });

  it("refuses a verdict for another token, and still records what the ask cost", async () => {
    const other = await mint({ chainId: 8453, token: tok() });
    const a = asker(() => paidAnswer({ id: other }));
    const d = deps({ telegraph: tg(a.client) });
    const app = await receive(d, { project: "Wrong Token", chainId: 8453, token: tok() }, "agent");
    const out = (await process(d, app.id))!;
    expect(out.decision).toMatchObject({ action: "analyst", verdict: null, rail: "telegraph", paidUsdc: 0.15, refusal: { code: "TELEGRAPH_MISMATCH" } });
  });
});

describe("rails on the Telegraph setting", () => {
  it("buys only telegraphFormDaily form applications a day through Telegraph, then uses the partner key", async () => {
    const a = asker((_c, params) => mint(params.subject).then((id) => paidAnswer({ id })));
    const d = deps({ telegraph: tg(a.client), skein: partner(), telegraphFormDaily: 1 });
    const one = await receive(d, { project: "Form One", chainId: 8453, token: tok() }, "form");
    const two = await receive(d, { project: "Form Two", chainId: 8453, token: tok() }, "form");
    const agentApp = await receive(d, { project: "Agent One", chainId: 8453, token: tok() }, "agent");
    expect((await process(d, one.id))!.decision).toMatchObject({ rail: "telegraph" });
    expect((await process(d, two.id))!.decision).toMatchObject({ rail: "apiKey", paidUsdc: 0 });
    expect((await process(d, agentApp.id))!.decision).toMatchObject({ rail: "telegraph" });
    expect(a.asks).toBe(2);
  });

  it("leaves form applications waiting when the allowance is spent and there is no partner key", async () => {
    const a = asker((_c, params) => mint(params.subject).then((id) => paidAnswer({ id })));
    const d = deps({ telegraph: tg(a.client), telegraphFormDaily: 0 });
    const app = await receive(d, { project: "Waits", chainId: 8453, token: tok() }, "form");
    expect((await process(d, app.id))!.status).toBe("received");
    expect(a.asks).toBe(0);
  });
});

describe("M20: the board index heals", () => {
  it("repairs an entry left behind by a lost index write", async () => {
    const d = deps({ telegraph: tg(asker((_c, params) => mint(params.subject).then((id) => paidAnswer({ id }))).client) });
    const app = await receive(d, { project: "Stale", chainId: 8453, token: tok() }, "agent");
    await process(d, app.id);
    // The decision was written, but the index still shows the application as received.
    const idx = await d.store.kv.get<ReturnType<typeof summarise>[]>("index");
    await d.store.kv.update("index", idx!.value.map((s) => (s.id === app.id ? summarise(app) : s)), idx!.etag);
    expect((await d.store.list())[0]!.status).toBe("received");
    await tick(d);
    expect((await d.store.list())[0]).toMatchObject({ status: "decided", decision: { rail: "telegraph", receiptHash: RECEIPT } });
  });

  it("never lets an older summary replace a decided one", async () => {
    const store = memoryStore();
    const d = deps({ store, telegraph: tg(asker((_c, params) => mint(params.subject).then((id) => paidAnswer({ id }))).client) });
    const app = await receive(d, { project: "Ordered", chainId: 8453, token: tok() }, "agent");
    await process(d, app.id);
    await store.reindex({ ...app, status: "buying" });
    expect((await store.list())[0]!.status).toBe("decided");
  });

  it("reports a written application as written even when the index write fails", async () => {
    const inner = memoryStore().kv;
    let breakIndex = false;
    const kv: KV = {
      get: (k) => inner.get(k),
      create: (k, v) => (breakIndex && k === "index" ? Promise.reject(new Error("store update index: HTTP 503")) : inner.create(k, v)),
      update: (k, v, e) => (breakIndex && k === "index" ? Promise.reject(new Error("store update index: HTTP 503")) : inner.update(k, v, e)),
    };
    const store = new Store(kv);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app: Application = { id: "app_indexfail1", receivedAt: new Date().toISOString(), source: "agent", project: "X", subject: { chainId: 8453, token: tok() }, context: {}, status: "received" };
    expect(await store.create(app)).toBe(true);
    breakIndex = true;
    const cur = await store.get(app.id);
    expect(await store.update({ ...app, status: "buying" }, cur!.etag)).toBe(true);
    breakIndex = false;
    expect((await store.list())[0]!.status).toBe("received");
    await store.heal((await store.get(app.id))!.value, (await store.list())[0]);
    expect((await store.list())[0]!.status).toBe("buying");
  });

  it("drops an index entry whose application is gone", async () => {
    const d = deps({ telegraph: tg(asker(() => null).client) });
    await d.store.kv.create("index", [{ id: "app_ghost00001", receivedAt: new Date().toISOString(), source: "form", project: "Ghost", subject: { chainId: 8453, token: tok() }, status: "received" }]);
    await tick(d);
    expect(await d.store.list()).toEqual([]);
  });
});
