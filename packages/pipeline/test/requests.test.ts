import { describe, expect, it } from "vitest";
import { ALLOWLIST } from "@skein/telegraph";
import { dexScreenerResolver } from "../src/pool";
import { buildRequest, forCandidate } from "../src/requests";

const subject = { chainId: 8453, token: "0x4200000000000000000000000000000000000006" };

describe("native requests", () => {
  it("send holder count its own query parameters", () => {
    const built = buildRequest("holder_count", "TOKEN_HOLDER_COUNT_GENERAL", subject, {});
    const cand = ALLOWLIST.holder_count!.find((m) => m.minerId === "7302")!;
    expect(built.ok && forCandidate(built.req, cand)).toEqual({ method: "GET", endpoint: "/holders", payload: { token: subject.token, chain: "base" }, acknowledge_warnings: true });
  });

  it("carry the chain from context when the intent's params have none (wash trading)", () => {
    const built = buildRequest("wash_trading", "WASH_TRADING_DETECTION_GENERAL", subject, {});
    const cand = ALLOWLIST.wash_trading!.find((m) => m.minerId === "7378")!;
    expect(built.ok && forCandidate(built.req, cand)).toEqual({ method: "GET", endpoint: "/washtrade", payload: { blocks: 600, token: subject.token, chain: "base" }, acknowledge_warnings: true });
  });

  it("leave a canonical miner's request untouched", () => {
    const built = buildRequest("liquidity_depth", "LIQUIDITY_DEPTH_VERIFY_GENERAL", subject, { pool: "0x00000000000000000000000000000000000000aa" });
    const cand = ALLOWLIST.liquidity_depth!.find((m) => m.minerId === "7373")!;
    expect(built.ok && forCandidate(built.req, cand)).toEqual(built.ok && built.req);
  });
});

describe("pool resolution", () => {
  it("keeps a Uniswap v4 pool id, and picks the deepest pool on the chain", async () => {
    const v4 = "0x21f38fe7da45583cde008d5a876be882e515f61819a2ccfc9e657bafb1a20317";
    const pairs = [
      { chainId: "base", pairAddress: "0x00000000000000000000000000000000000000aa", liquidity: { usd: 900 } },
      { chainId: "base", pairAddress: v4.toUpperCase().replace("0X", "0x"), liquidity: { usd: 21220.11 } },
      { chainId: "ethereum", pairAddress: "0x00000000000000000000000000000000000000bb", liquidity: { usd: 1e9 } },
      { chainId: "base", pairAddress: "not-a-pool", liquidity: { usd: 1e9 } },
    ];
    const fetchStub = (async () => new Response(JSON.stringify({ pairs }))) as unknown as typeof fetch;
    expect(await dexScreenerResolver(fetchStub).resolve(8453, subject.token)).toBe(v4);
  });
});
