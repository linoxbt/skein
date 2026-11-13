import { simulatedApi } from "@skein/api/simulated";
import { Skein, type TelegraphAsker } from "@skeinlabs/sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { receive, type AgentDeps } from "../lib/agent";
import { autoId, dexscreenerCandidates, intake, projectName, runAgent, slotsOpen, SNIPER_FEED_URL, sniperCandidates } from "../lib/intake";
import { memoryStore } from "../lib/store";

const NOW = new Date("2026-12-03T23:00:00Z");
const hex = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

/** The public feeds, as they answer (shapes read from the live endpoints on 2026-11-12). */
function feeds(o: { base?: string[]; sniper?: { token: string; seenAt: string; name?: string }[] } = {}) {
  const base = o.base ?? [hex(0xb1), hex(0xb2), hex(0xb3), hex(0xb4)];
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url === "https://api.dexscreener.com/token-profiles/latest/v1") {
      return Response.json([
        { url: "https://dexscreener.com/solana/abc", chainId: "solana", tokenAddress: "FyHakvZH3L4UABSQYK7e9ECEzWV37u7GTkmAbHXspump" },
        ...base.map((t, i) => ({ url: `https://dexscreener.com/base/${t}`, chainId: "base", tokenAddress: t, links: i === 0 ? [{ label: "Website", url: "https://x.example" }, { type: "twitter", url: "https://x.com/basecoin" }] : [] })),
        { url: "https://dexscreener.com/bsc/x", chainId: "bsc", tokenAddress: "0x123" },
        { url: "https://dexscreener.com/base/0", chainId: "base", tokenAddress: hex(0) },
        { url: "https://dexscreener.com/polygon/x", chainId: "polygon", tokenAddress: hex(0xdd) },
      ]);
    }
    if (url.startsWith("https://api.dexscreener.com/tokens/v1/base/")) {
      return Response.json(base.map((t, i) => ({ baseToken: { address: t.toUpperCase().replace("0X", "0x"), name: i === 0 ? "Base Coin" : i === 1 ? "Visit rug.com <script>" : "", symbol: i === 2 ? "SYM" : "" } })));
    }
    if (url === SNIPER_FEED_URL) {
      return Response.json({ decisions: (o.sniper ?? []).map((d) => ({ ...d, marketUrl: `https://dexscreener.com/base/${d.token}`, status: "decided" })) });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, calls };
}

function deps(o: Partial<AgentDeps> = {}): AgentDeps {
  // The intake needs a working agent; the partner-key rail is enough to file.
  const skein = new Skein({ apiUrl: "http://skein.invalid", payer: { kind: "apiKey", key: "k" } });
  return { store: memoryStore(), skein, rail: "apiKey", webUrl: "https://skein.test", now: () => NOW, ...o };
}

describe("feeds", () => {
  it("keeps only launches the form would accept, with names fit for a public board", async () => {
    const { fetchImpl } = feeds();
    const c = await dexscreenerCandidates(fetchImpl);
    expect(c.map((x) => x.token)).toEqual([hex(0xb1), hex(0xb2), hex(0xb3), hex(0xb4)]);
    expect(c[0]).toMatchObject({ chainId: 8453, project: "Base Coin", social: "basecoin", origin: { feed: "dexscreener", url: `https://dexscreener.com/base/${hex(0xb1)}` } });
    // A name that carries a link falls back; then the symbol; then the address.
    expect(c[1]!.project).toBe(`Token ${hex(0xb2).slice(0, 8)}`);
    expect(c[2]!.project).toBe("SYM");
    expect(projectName("  $PEPE🐸 2.0 ", null, hex(1))).toBe("PEPE 2.0");
  });

  it("takes the sniper's launches from the last day only", async () => {
    const { fetchImpl } = feeds({ sniper: [{ token: hex(0xc1), seenAt: "2026-12-03T20:00:00Z", name: "Fresh" }, { token: hex(0xc2), seenAt: "2026-12-01T20:00:00Z" }] });
    expect((await sniperCandidates(fetchImpl, NOW)).map((x) => [x.token, x.project, x.origin.feed])).toEqual([[hex(0xc1), "Fresh", "sniper"]]);
  });

  it("survives a feed that is down or answers nonsense", async () => {
    expect(await dexscreenerCandidates(async () => new Response("<html>", { status: 200 }))).toEqual([]);
    expect(await sniperCandidates(async () => Promise.reject(new Error("down")), NOW)).toEqual([]);
  });
});

describe("the agent's own intake", () => {
  it("opens its daily slots through the day", () => {
    expect(slotsOpen(4, new Date("2026-12-03T00:00:00Z"))).toBe(1);
    expect(slotsOpen(4, new Date("2026-12-03T06:00:00Z"))).toBe(2);
    expect(slotsOpen(4, new Date("2026-12-03T23:59:59Z"))).toBe(4);
    expect(slotsOpen(1, new Date("2026-12-03T23:59:59Z"))).toBe(1);
  });

  it("files a fresh launch as an agent application, once per open slot", async () => {
    const { fetchImpl, calls } = feeds();
    const d = deps();
    const r = await intake(d, { daily: 1, fetch: fetchImpl, feeds: ["dexscreener"] });
    expect(r.reason).toBe("filed");
    expect(r.filed).toMatchObject({ id: autoId(8453, hex(0xb1)), source: "agent", project: "Base Coin", subject: { chainId: 8453, token: hex(0xb1) }, context: { social: "basecoin" }, origin: { feed: "dexscreener" } });
    expect((await d.store.list())[0]).toMatchObject({ source: "agent", origin: "dexscreener", status: "received" });
    const before = calls.length;
    expect((await intake(d, { daily: 1, fetch: fetchImpl, feeds: ["dexscreener"] })).reason).toBe("budget");
    // A spent budget costs one store read, and no feed call.
    expect(calls.length).toBe(before);
  });

  it("never files a token twice: not one already on the board, not one it filed before", async () => {
    const { fetchImpl } = feeds({ base: [hex(0xe1), hex(0xe2), hex(0xe3)] });
    const d = deps();
    await receive(d, { project: "By Hand", chainId: 8453, token: hex(0xe1) }, "form");
    // Filed on an earlier day, and no longer in the index.
    await d.store.kv.create(`app/${autoId(8453, hex(0xe2))}`, { id: autoId(8453, hex(0xe2)) });
    const r = await intake(d, { daily: 1, fetch: fetchImpl, feeds: ["dexscreener"] });
    expect(r.filed?.subject.token).toBe(hex(0xe3));
  });

  it("files exactly its budget when runs overlap, each token once", async () => {
    const { fetchImpl } = feeds({ base: [hex(0xf1), hex(0xf2), hex(0xf3), hex(0xf4), hex(0xf5), hex(0xf6)] });
    const d = deps();
    const runs = await Promise.all(Array.from({ length: 8 }, () => intake(d, { daily: 3, fetch: fetchImpl, feeds: ["dexscreener"] })));
    const filed = runs.filter((r) => r.filed).map((r) => r.filed!.id);
    expect(filed).toHaveLength(3);
    expect(new Set(filed).size).toBe(3);
    expect(await d.store.count(`auto/${NOW.toISOString().slice(0, 10)}`)).toBe(3);
    expect((await d.store.list()).filter((s) => s.source === "agent")).toHaveLength(3);
  });

  it("is off with a zero budget, or while the agent cannot buy", async () => {
    const { fetchImpl, calls } = feeds();
    expect((await intake(deps(), { daily: 0, fetch: fetchImpl })).reason).toBe("off");
    expect((await intake(deps({ skein: null }), { daily: 3, fetch: fetchImpl })).reason).toBe("off");
    expect(calls).toEqual([]);
  });
});

describe("C1: an autonomous Telegraph purchase, end to end", () => {
  let api: Awaited<ReturnType<typeof simulatedApi>>;
  beforeAll(async () => {
    api = await simulatedApi({ fast: true, env: {} });
  });

  it("files a launch nobody applied for and buys its verdict through Telegraph", async () => {
    const apiFetch = (i: RequestInfo | URL, init?: RequestInit) => Promise.resolve(api.app.fetch(new Request(String(i), init)));
    let asks = 0;
    const asker: TelegraphAsker = {
      ask: async (req, opts) => {
        asks++;
        expect(req.intent).toBe("FRAUD_RISK_GENERAL");
        expect(opts.minerId).toBe("845301");
        const res = await api.app.request("/v1/verdicts", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${api.key}`, "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({ subject: (req.params as { subject: unknown }).subject }),
        });
        const v = (await res.json()) as { id: string };
        return { ok: true, response: { miner_id: "845301", result: { id: v.id } }, receipt: { receipt_hash: `0x${"77".repeat(32)}` }, amountUusdc: 250_000, durationMs: 5 };
      },
    };
    const { fetchImpl } = feeds({ base: [hex(0x1a1)] });
    const d = deps({
      skein: null,
      rail: "telegraph",
      now: () => new Date(),
      telegraph: (wrap) => new Skein({ apiUrl: "http://skein.test", payer: { kind: "telegraph", client: wrap(asker), intent: "FRAUD_RISK_GENERAL", minerId: "845301" }, fetch: apiFetch }),
    });
    const out = await runAgent(d, { budgetMs: 30_000, daily: 1, fetch: fetchImpl, feeds: ["dexscreener"] });
    expect(out).toMatchObject({ intake: { reason: "filed" }, decided: 1, open: 0 });
    const [s] = await d.store.list();
    expect(s).toMatchObject({ source: "agent", status: "decided", decision: { rail: "telegraph", paidUsdc: 0.25, billing: "paid", minerId: "845301", receiptHash: `0x${"77".repeat(32)}` } });
    // The next run finds the slot used and asks nothing more.
    expect(await runAgent(d, { budgetMs: 30_000, daily: 1, fetch: fetchImpl, feeds: ["dexscreener"] })).toMatchObject({ intake: { reason: "budget" }, decided: 0 });
    expect(asks).toBe(1);
  });
});
