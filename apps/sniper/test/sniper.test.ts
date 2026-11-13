import { simulatedApi } from "@skein/api/simulated";
import { Skein, SkeinError, type VerdictResult } from "@skeinlabs/sdk";
import { verifyAttestation } from "@skeinlabs/sdk/attest";
import { privateKeyToAccount } from "viem/accounts";
import { beforeAll, describe, expect, it } from "vitest";
import { BLOCKER_LIQUIDITY_USD, liquidityFloor, Sniper, type AgentDeps } from "../src/agent";
import type { Market, MarketSource } from "../src/market";
import { buildFeed, cachedFeed, createServer } from "../src/server";
import { memoryStore, pgStoreOn, type PgLike, type Store, type TokenRecord } from "../src/store";
import { decodeLaunch, FACTORIES, Watcher, type Chain } from "../src/watch";

const ATTESTATION_KEY = `0x${"66".repeat(32)}` as const;
const ATTESTER = privateKeyToAccount(ATTESTATION_KEY).address;
let api: Awaited<ReturnType<typeof simulatedApi>>;
beforeAll(async () => {
  api = await simulatedApi({ fast: true, env: {}, config: { attestationKey: ATTESTATION_KEY } });
});
const skein = () =>
  new Skein({ apiUrl: "http://skein.test", payer: { kind: "apiKey", key: api.key }, fetch: (i, init) => Promise.resolve(api.app.fetch(new Request(String(i), init))) });
/** The production check: Skein's signature against the pinned attester. */
const verify = async (v: VerdictResult) => (v.attestation ? (await verifyAttestation(v, { signer: ATTESTER })).ok : false);
const sniper = (d: Omit<AgentDeps, "rail" | "verify" | "skein"> & Partial<Pick<AgentDeps, "rail" | "verify" | "skein">>) => new Sniper({ rail: "apiKey", verify, skein: skein(), ...d });

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

/** A stand-in for the SDK client: answers each verdict() as the test says, and counts the asks. */
function stubSkein(answer: (token: string, call: number) => Partial<VerdictResult> | Error, delayMs = 0) {
  const asked: string[] = [];
  const s = {
    asked,
    async verdict(req: { subject: { chainId: number; token: string }; policy?: string }) {
      asked.push(req.subject.token);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const a = answer(req.subject.token, asked.length);
      if (a instanceof Error) throw a;
      return {
        id: `vrd_${asked.length}`, verdict: "APPROVE", riskBps: 100, summary: "ok", reasons: [], openRisks: [],
        subject: { chainId: 8453, token: req.subject.token }, policy: { id: "agent-pretrade", version: "0.3.0" },
        cost: { priceUsdc: 0.25, upstreamUsdc: 0.05, currency: "USDC" }, bom: { root: "0x", items: 5 }, verdictHash: "0x",
        payment: { rail: "telegraph", minerId: "845301", amountUsdc: 0.25, receiptHash: null, signalHash: null },
        ...a,
      } as VerdictResult;
    },
  };
  return s as typeof s & Skein;
}
const watched = async (store: Store, tokens: string[], at: Date) => {
  for (const t of tokens) await store.add({ token: t, dex: "aerodrome", pool: null, block: 1, tx: "0x" }, at);
};

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
  it("waits for liquidity, buys one verdict per token, and trades only on a signed APPROVE", async () => {
    const store = memoryStore();
    const book = new Map<string, Partial<Market>>();
    let now = new Date("2026-11-05T12:00:00Z");
    const clean = tok("a");
    const conflict = tok("c"); // the simulated wash-trading conflict: ESCALATE
    const dust = tok("a");
    const s = sniper({ store, market: fakeMarket(book), now: () => now, config: { minAgeMin: 5, minLiquidityUsd: 10_000, checksPerTick: 5, priceRefreshMin: 1 } });
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
    expect(byToken[clean]).toMatchObject({ signatureOk: true, subjectOk: true });
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
    expect(feed.watching).toBe(1);

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
    await watched(store, tokens, new Date(now.getTime() - 10 * 60_000));
    for (const t of tokens) book.set(t, { liquidityUsd: 60_000 });
    const s = sniper({ store, market: fakeMarket(book), now: () => now, config: { dailyChecks: 2, checksPerTick: 5 } });
    await s.tick();
    await s.tick();
    expect((await store.stats(new Date(0))).checked).toBe(2);
    expect((await store.byStatus("watching", 10)).length).toBe(1);
  });

  it("records a refusal as an error, not a trade", async () => {
    const store = memoryStore();
    const now = new Date("2026-11-05T12:00:00Z");
    const t = tok("a");
    await watched(store, [t], now);
    const s = sniper({ store, market: fakeMarket(new Map()), now: () => now, config: { policy: "no-such-policy" } });
    const out = (await s.check((await store.byStatus("watching", 1))[0]!)) as TokenRecord;
    expect(out).toMatchObject({ status: "error", action: "skip" });
    expect(out.note).toMatch(/UNKNOWN_POLICY/);
  });
});

describe("no verified signature, no trade (M13)", () => {
  const once = async (deps: Partial<AgentDeps>, answer: Parameters<typeof stubSkein>[0]) => {
    const store = memoryStore();
    const t = tok("a");
    await watched(store, [t], new Date("2026-11-05T12:00:00Z"));
    const s = sniper({ store, market: fakeMarket(new Map()), now: () => new Date("2026-11-05T12:10:00Z"), skein: stubSkein(answer), ...deps });
    return { t, out: (await s.check((await store.byStatus("watching", 1))[0]!)) as TokenRecord };
  };

  it("skips an APPROVE whose signature does not verify", async () => {
    const { out } = await once({ verify: async () => false }, () => ({}));
    expect(out).toMatchObject({ verdict: "APPROVE", action: "skip", signatureOk: false });
    expect(out.note).toMatch(/signature/);
    // A real verdict with its attestation stripped does not verify either.
    const real = await skein().verdict({ subject: { chainId: 8453, token: tok("a") }, policy: "agent-pretrade@0.3.0" });
    expect(await verify(real)).toBe(true);
    expect(await verify({ ...real, attestation: undefined })).toBe(false);
    expect(await verify({ ...real, verdict: "APPROVE", riskBps: real.riskBps + 1 })).toBe(false);
  });

  it("skips a signed APPROVE about another token, chain or policy", async () => {
    for (const wrong of [
      { subject: { chainId: 8453, token: `0x${"9".repeat(40)}` } },
      (t: string) => ({ subject: { chainId: 1, token: t } }),
      { policy: { id: "dex-list", version: "0.2.0" } },
    ]) {
      const { out } = await once({ verify: async () => true }, (t) => (typeof wrong === "function" ? wrong(t) : wrong));
      expect(out).toMatchObject({ verdict: "APPROVE", action: "skip", subjectOk: false });
      expect(out.note).toMatch(/not acted on/);
    }
    const { out } = await once({ verify: async () => true }, (t) => ({ subject: { chainId: 8453, token: t.toUpperCase().replace("0X", "0x") } }));
    expect(out).toMatchObject({ action: "buy", subjectOk: true, signatureOk: true });
  });

  it("will not run without a signature check", () => {
    expect(() => new Sniper({ store: memoryStore(), market: fakeMarket(new Map()), skein: skein(), rail: "apiKey" } as unknown as AgentDeps)).toThrow(/attester/);
  });
});

describe("daily caps and restarts (M14)", () => {
  const day = new Date("2026-11-05T12:00:00Z");
  const book = (tokens: string[]) => new Map(tokens.map((t) => [t, { liquidityUsd: 90_000 } as Partial<Market>]));

  it("counts failed checks against the daily check cap", async () => {
    const store = memoryStore();
    const tokens = [tok("a"), tok("a"), tok("a"), tok("a")];
    await watched(store, tokens, new Date(day.getTime() - 10 * 60_000));
    const stub = stubSkein(() => new SkeinError("VERDICT_FAILED", "upstream down", 503));
    const s = sniper({ store, market: fakeMarket(book(tokens)), now: () => day, skein: stub, config: { dailyChecks: 2, checksPerTick: 5 } });
    await s.tick();
    await s.tick();
    expect(stub.asked).toHaveLength(2);
    expect((await store.stats(day)).errors).toBe(2);
    expect(await store.count("watching")).toBe(2);
  });

  it("stops at the daily USDC cap, counting paid failures and reserving checks in flight", async () => {
    const store = memoryStore();
    const tokens = [tok("a"), tok("a"), tok("a"), tok("a")];
    await watched(store, tokens, new Date(day.getTime() - 10 * 60_000));
    // The second ask is paid and fails (billing unknown): its 0.25 still counts.
    const stub = stubSkein((_t, call) => (call === 2 ? new SkeinError("TELEGRAPH_TIMEOUT", "no answer", 0, undefined, { amountUsdc: 0.25, billing: "unknown" }) : {}));
    const s = sniper({ store, market: fakeMarket(book(tokens)), now: () => day, skein: stub, rail: "telegraph", verify: async () => true, config: { dailyChecks: 40, checksPerTick: 5, dailyUsdc: 0.8, maxUsdcPerCall: 0.3 } });
    await s.tick();
    await s.tick();
    // 0 + 0.3 ≤ 0.8, 0.25 + 0.3 ≤ 0.8, 0.5 + 0.3 ≤ 0.8, then 0.75 + 0.3 > 0.8.
    expect(stub.asked).toHaveLength(3);
    const st = await store.stats(day);
    expect(st.paidUsdc).toBeCloseTo(0.75);
    expect(st.errors).toBe(1);
  });

  it("never re-asks a Telegraph check a restart interrupted, and counts it as paid", async () => {
    const store = memoryStore();
    const [inFlight, fresh] = [tok("a"), tok("a")];
    await watched(store, [inFlight, fresh], new Date(day.getTime() - 30 * 60_000));
    // A previous process claimed this check and died before saving its answer.
    const before = (await store.byStatus("watching", 10)).find((r) => r.token === inFlight)!;
    expect(await store.claim({ ...before, checkedAt: new Date(day.getTime() - 20 * 60_000).toISOString(), rail: "telegraph" }, { since: day, maxChecks: 9, maxUsdc: 9, reserveUsdc: 0.3 })).toBe("claimed");
    const stub = stubSkein(() => ({}));
    const s = sniper({ store, market: fakeMarket(book([inFlight, fresh])), now: () => day, skein: stub, rail: "telegraph", verify: async () => true, config: { checksPerTick: 5, staleCheckMin: 15 } });
    await s.tick();
    expect(stub.asked).toEqual([fresh]);
    const rec = (await store.checkedSince(new Date(0), 10)).find((r) => r.token === inFlight)!;
    expect(rec).toMatchObject({ status: "error", paidUsdc: 0.3 });
    expect(rec.note).toMatch(/not asked again/);
    await s.tick();
    expect(stub.asked).toEqual([fresh]);
  });

  it("leaves a check in flight alone until it is stale, and requeues an interrupted partner-key check", async () => {
    const store = memoryStore();
    const t = tok("a");
    await watched(store, [t], new Date(day.getTime() - 30 * 60_000));
    const r = (await store.byStatus("watching", 1))[0]!;
    await store.claim({ ...r, checkedAt: new Date(day.getTime() - 5 * 60_000).toISOString(), rail: "apiKey" }, { since: day, maxChecks: 9, maxUsdc: 9, reserveUsdc: 0 });
    let now = day;
    const stub = stubSkein(() => ({ payment: { rail: "apiKey" } }));
    const s = sniper({ store, market: fakeMarket(book([t])), now: () => now, skein: stub, verify: async () => true });
    await s.tick();
    expect(stub.asked).toHaveLength(0);
    expect(await store.count("checking")).toBe(1);
    now = new Date(day.getTime() + 15 * 60_000);
    await s.tick();
    // Requeued (the idempotency key returns the original verdict uncharged), then checked.
    expect(stub.asked).toEqual([t]);
    expect((await store.checkedSince(new Date(0), 1))[0]).toMatchObject({ status: "decided", action: "buy" });
  });

  it("two replicas on one store ask once per token and share the cap", async () => {
    const store = memoryStore();
    const tokens = Array.from({ length: 6 }, () => tok("a"));
    await watched(store, tokens, new Date(day.getTime() - 10 * 60_000));
    const stub = stubSkein(() => ({}), 20);
    const replica = () => sniper({ store, market: fakeMarket(book(tokens)), now: () => day, skein: stub, rail: "telegraph", verify: async () => true, config: { dailyChecks: 4, checksPerTick: 6, dailyUsdc: 100 } });
    await Promise.all([replica().tick(), replica().tick()]);
    expect(new Set(stub.asked).size).toBe(stub.asked.length);
    expect(stub.asked).toHaveLength(4);
  });
});

describe("the liquidity floor (M15)", () => {
  it("is never below the policy's liquidity_depth FAIL threshold", async () => {
    const res = await api.app.request("/v1/policies/agent-pretrade@0.3.0");
    const policy = await res.json();
    expect(liquidityFloor(policy, 10_000)).toMatchObject({ floor: 50_000 });
    expect(liquidityFloor(policy, 80_000)).toMatchObject({ floor: 80_000, source: "configured" });
    expect(liquidityFloor({ thresholds: { liquidity_depth: { fail: 75_000 } } }, 10_000).floor).toBe(75_000);
    // Unreadable: at least the blocker floor.
    expect(liquidityFloor(null, 10_000).floor).toBe(BLOCKER_LIQUIDITY_USD);
    expect(new Sniper({ store: memoryStore(), market: fakeMarket(new Map()), skein: skein(), rail: "apiKey", verify }).cfg.minLiquidityUsd).toBeGreaterThanOrEqual(BLOCKER_LIQUIDITY_USD);
  });
});

/** PGlite behind pg.Pool's shape, one connection handed out at a time. */
function pgOnPglite(pg: { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }> }): PgLike {
  let lock = Promise.resolve();
  const query: PgLike["query"] = async (t, p) => {
    const r = await pg.query(t, p);
    return { rows: r.rows as never[], rowCount: r.affectedRows ?? r.rows.length };
  };
  return {
    query,
    async connect() {
      let release!: () => void;
      const held = lock;
      lock = new Promise<void>((r) => (release = r));
      await held;
      return { query, release };
    },
  };
}

describe("the Postgres store", () => {
  it("tallies in SQL and claims under the caps", async () => {
    const pg = (api.db as unknown as { $client: { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }>; exec: (s: string) => Promise<unknown> } }).$client;
    await pg.exec("RESET ROLE");
    try {
      const store = await pgStoreOn(pgOnPglite(pg));
      const tokens = [tok("a"), tok("a"), tok("a"), tok("a")];
      const day = new Date("2026-11-05T00:00:00Z");
      await watched(store, tokens, new Date("2026-11-05T10:00:00Z"));
      expect(await store.count("watching")).toBeGreaterThanOrEqual(4);
      const at = "2026-11-05T12:00:00.000Z";
      const limits = { since: day, maxChecks: 3, maxUsdc: 0.7, reserveUsdc: 0.3 };
      const recs = await Promise.all(tokens.map(async (t) => (await store.byStatus("watching", 500)).find((r) => r.token === t)!));
      expect(await store.claim({ ...recs[0]!, checkedAt: at }, limits)).toBe("claimed");
      expect(await store.claim({ ...recs[0]!, checkedAt: at }, limits)).toBe("taken");
      await store.save({ ...recs[0]!, status: "decided", checkedAt: at, action: "buy", paidUsdc: 0.25, priceUsdc: 0.25 });
      expect(await store.claim({ ...recs[1]!, checkedAt: at }, limits)).toBe("claimed");
      await store.save({ ...recs[1]!, status: "error", checkedAt: at, paidUsdc: 0.25 });
      // 0.5 paid + 0.3 reserved > 0.7: the USDC cap.
      expect(await store.claim({ ...recs[2]!, checkedAt: at }, limits)).toBe("cap");
      expect(await store.claim({ ...recs[2]!, checkedAt: at }, { ...limits, maxUsdc: 10 })).toBe("claimed");
      // Three checks today (decided, error, in flight): the check cap.
      expect(await store.claim({ ...recs[3]!, checkedAt: at }, { ...limits, maxUsdc: 10 })).toBe("cap");
      const s = await store.stats(day);
      expect(s).toMatchObject({ checked: 1, bought: 1, dodged: 0, errors: 1, inFlight: 1, paidUsdc: 0.5, listUsdc: 0.25 });
      expect(s.seen).toBeGreaterThanOrEqual(4);
    } finally {
      await pg.exec(`SET ROLE skein_app`);
    }
  });
});

describe("the dashboard server", () => {
  it("sends security headers, and rate-limits /checked.json and /feed.json", async () => {
    const { rateLimiter } = await import("../src/server");
    const app = createServer(memoryStore(), { policy: "agent-pretrade@0.3.0", minLiquidityUsd: 1, minAgeMin: 1, maxAgeMin: 2, dailyChecks: 1, ticketUsd: 1 } as never, { rail: "apiKey", attester: null, skeinWeb: "https://skeinlabs.site" });
    const home = await app.request("/");
    expect(home.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(home.headers.get("x-content-type-options")).toBe("nosniff");
    const ok = await app.request("/checked.json", { headers: { "x-forwarded-for": "203.0.113.9" } });
    expect(ok.status).toBe(200);
    const feeds = [];
    for (let i = 0; i < 61; i++) feeds.push((await app.request("/feed.json", { headers: { "x-forwarded-for": "203.0.113.10" } })).status);
    expect(feeds.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(feeds[60]).toBe(429);
    let t = 0;
    const take = rateLimiter(2, () => t);
    expect([take("a"), take("a"), take("a")]).toEqual([true, true, false]);
    t = 60_000;
    expect(take("a")).toBe(true);
  });

  it("builds the feed at most once per window, however many readers", async () => {
    let builds = 0;
    let t = 0;
    const feed = cachedFeed(async () => (builds++, { generatedAt: String(t) }) as never, 10_000, () => t);
    await Promise.all([feed(), feed(), feed()]);
    expect(builds).toBe(1);
    t = 10_001;
    await feed();
    expect(builds).toBe(2);
  });
});
