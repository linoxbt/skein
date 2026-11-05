import { simulatedApi } from "@skein/api/simulated";
import { Skein } from "@skeinlabs/sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { Sniper } from "../src/agent";
import type { Market, MarketSource } from "../src/market";
import { buildFeed } from "../src/server";
import { memoryStore } from "../src/store";
import { decodeLaunch, FACTORIES, Watcher, type Chain } from "../src/watch";

let api: Awaited<ReturnType<typeof simulatedApi>>;
beforeAll(async () => {
  api = await simulatedApi({ fast: true, env: {} });
});
const skein = () =>
  new Skein({ apiUrl: "http://skein.test", payer: { kind: "apiKey", key: api.key }, fetch: (i, init) => Promise.resolve(api.app.fetch(new Request(String(i), init))) });

let n = 0;
const tok = (suffix = "a") => `0x${(++n).toString(16).padStart(39, "0")}${suffix}`;
const pad = (a: string) => `0x${a.slice(2).padStart(64, "0")}`;
const WETH = "0x4200000000000000000000000000000000000006";

/** A market that reports whatever liquidity and price the test sets. */
function fakeMarket(book: Map<string, Partial<Market>>): MarketSource {
  return {
    async get(tokens) {
      const out = new Map<string, Market>();
      for (const t of tokens) {
        const m = book.get(t);
        if (m) out.set(t, { token: t, symbol: "TEST", name: "Test", priceUsd: 1, liquidityUsd: 0, pair: null, dex: "uniswap", url: null, ...m });
      }
      return out;
    },
  };
}

describe("watch: factory events to launches", () => {
  it("decodes a v3 pool and a v4 pool, keeps the non-quote token, drops quote/quote pairs", () => {
    const v3 = FACTORIES.find((f) => f.dex === "uniswap-v3")!;
    const v4 = FACTORIES.find((f) => f.dex === "uniswap-v4")!;
    const t = tok();
    const pool = "0x00000000000000000000000000000000000000aa";
    const l3 = decodeLaunch({ address: v3.address, topics: [v3.topic0, pad(WETH), pad(t), pad("0x0bb8")], data: `0x${"0".repeat(63)}a${pad(pool).slice(2)}`, blockNumber: "0x10", transactionHash: "0x1" });
    expect(l3).toMatchObject({ token: t, dex: "uniswap-v3", pool, block: 16 });
    const l4 = decodeLaunch({ address: v4.address, topics: [v4.topic0, `0x${"ab".repeat(32)}`, pad("0x0"), pad(t)], data: "0x", blockNumber: "0x11", transactionHash: "0x2" });
    expect(l4).toMatchObject({ token: t, dex: "uniswap-v4", pool: null });
    expect(decodeLaunch({ address: v3.address, topics: [v3.topic0, pad(WETH), pad("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"), pad("0x01")], data: "0x", blockNumber: "0x1", transactionHash: "0x3" })).toBeNull();
  });

  it("follows the chain in bounded windows", async () => {
    const spans: [number, number][] = [];
    const chain: Chain = { head: async () => 1_000, logs: async (a, b) => (spans.push([a, b]), []) };
    const w = new Watcher(chain, 20);
    await w.poll();
    await w.poll();
    expect(spans).toEqual([[970, 989], [990, 1000]]);
  });
});

describe("the sniper", () => {
  it("waits for liquidity, buys one verdict per token, and trades only on APPROVE", async () => {
    const store = memoryStore();
    const book = new Map<string, Partial<Market>>();
    let now = new Date("2026-11-05T12:00:00Z");
    const clean = tok("a");
    const conflict = tok("c"); // the simulated wash-trading conflict: ESCALATE
    const dust = tok("a");
    const s = new Sniper({ store, market: fakeMarket(book), skein: skein(), now: () => now, config: { minAgeMin: 5, minLiquidityUsd: 10_000, checksPerTick: 5, priceRefreshMin: 1 } });
    for (const t of [clean, conflict, dust]) await store.add({ token: t, dex: "uniswap-v4", pool: null, block: 1, tx: "0x" }, now);

    // Too young: nothing bought.
    await s.tick();
    expect((await store.stats(new Date(0))).checked).toBe(0);

    // Old enough, but only two have liquidity: two verdicts, none for the dust token.
    now = new Date(now.getTime() + 6 * 60_000);
    book.set(clean, { liquidityUsd: 80_000, priceUsd: 2 });
    book.set(conflict, { liquidityUsd: 40_000, priceUsd: 1 });
    book.set(dust, { liquidityUsd: 900 });
    await s.tick();
    const decided = await store.checkedSince(new Date(0), 10);
    expect(decided.map((r) => r.token).sort()).toEqual([clean, conflict].sort());
    const byToken = Object.fromEntries(decided.map((r) => [r.token, r]));
    expect(byToken[conflict]).toMatchObject({ status: "decided", verdict: "ESCALATE", action: "skip" });
    expect(byToken[clean]!.verdict).toBeTruthy();
    expect(byToken[clean]!.action).toBe(byToken[clean]!.verdict === "APPROVE" ? "buy" : "skip");
    expect(byToken[clean]).toMatchObject({ priceAtCheck: 2, rail: "apiKey", paidUsdc: 0, ageAtCheckMin: 6 });
    expect(byToken[clean]!.verdictId).toMatch(/^vrd_/);

    // A checked token is never bought twice, and its price is tracked.
    now = new Date(now.getTime() + 2 * 60_000);
    book.set(clean, { liquidityUsd: 80_000, priceUsd: 1 });
    await s.tick();
    expect((await store.stats(new Date(0))).checked).toBe(2);
    const feed = await buildFeed(store, s.cfg, { rail: "apiKey", attester: null }, now);
    expect(feed.decisions.find((r) => r.token === clean)!.change).toBeCloseTo(-0.5);

    // The dust token expires without a verdict ever being bought for it.
    now = new Date(now.getTime() + 7 * 3_600_000);
    await s.tick();
    expect((await store.byStatus("expired", 10)).map((r) => r.token)).toContain(dust);
    expect((await store.stats(new Date(0))).checked).toBe(2);
  });

  it("stops at the daily verdict cap", async () => {
    const store = memoryStore();
    const book = new Map<string, Partial<Market>>();
    const now = new Date("2026-11-05T12:00:00Z");
    const tokens = [tok("a"), tok("a"), tok("a")];
    for (const t of tokens) {
      await store.add({ token: t, dex: "aerodrome", pool: null, block: 1, tx: "0x" }, new Date(now.getTime() - 10 * 60_000));
      book.set(t, { liquidityUsd: 50_000 });
    }
    const s = new Sniper({ store, market: fakeMarket(book), skein: skein(), now: () => now, config: { dailyChecks: 2, checksPerTick: 5 } });
    await s.tick();
    await s.tick();
    expect((await store.stats(new Date(0))).checked).toBe(2);
    expect((await store.byStatus("watching", 10)).length).toBe(1);
  });

  it("records a refusal as an error, not a trade", async () => {
    const store = memoryStore();
    const now = new Date("2026-11-05T12:00:00Z");
    const t = tok("a");
    await store.add({ token: t, dex: "uniswap-v3", pool: null, block: 1, tx: "0x" }, now);
    const s = new Sniper({ store, market: fakeMarket(new Map()), skein: skein(), now: () => now, config: { policy: "no-such-policy" } });
    const out = await s.check((await store.byStatus("watching", 1))[0]!);
    expect(out).toMatchObject({ status: "error", action: "skip" });
    expect(out.note).toMatch(/UNKNOWN_POLICY/);
  });
});
