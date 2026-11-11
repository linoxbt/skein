import { afterEach, describe, expect, it, vi } from "vitest";

// A chain whose block times drift (2 s, then 1 s after block 600k), served by a fake JSON-RPC node.
const HEAD = 1_000_000;
const tsOf = (n: number) => (n <= 600_000 ? 1_700_000_000 + 2 * n : 1_700_000_000 + 1_200_000 + (n - 600_000));
let calls = 0;
function node(opts: { nullEvery?: number } = {}) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    calls++;
    const { method, params } = JSON.parse(String(init.body)) as { method: string; params: string[] };
    if (opts.nullEvery && calls % opts.nullEvery === 0) return Response.json({ jsonrpc: "2.0", id: 1, result: null });
    if (method === "eth_blockNumber") return Response.json({ jsonrpc: "2.0", id: 1, result: `0x${HEAD.toString(16)}` });
    const n = Number.parseInt(params[0]!, 16);
    return Response.json({ jsonrpc: "2.0", id: 1, result: { timestamp: `0x${tsOf(n).toString(16)}` } });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("blockAt", () => {
  it("finds the last block at or before a time, in a few dozen calls at most", async () => {
    const { blockAt } = await import("../src/chain");
    for (const at of [tsOf(123_456) + 1, tsOf(599_999), tsOf(600_001), tsOf(999_000) + 0.5, tsOf(42)]) {
      calls = 0;
      vi.stubGlobal("fetch", node());
      const b = await blockAt("https://rpc.test", Math.floor(at));
      expect(tsOf(b.number)).toBeLessThanOrEqual(Math.floor(at));
      expect(tsOf(b.number + 1)).toBeGreaterThan(Math.floor(at));
      expect(calls).toBeLessThan(45);
    }
  });

  it("retries a node that answers with no result instead of reading undefined", async () => {
    const { blockAt } = await import("../src/chain");
    calls = 0;
    vi.stubGlobal("fetch", node({ nullEvery: 5 }));
    const b = await blockAt("https://rpc.test", tsOf(321_000));
    expect(b.number).toBe(321_000);
  }, 60_000);
});
