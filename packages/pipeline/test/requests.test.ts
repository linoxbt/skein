import { describe, expect, it } from "vitest";
import { ALLOWLIST } from "@skein/telegraph";
import { buildRequest, forCandidate } from "../src/requests";

const subject = { chainId: 8453, token: "0x4200000000000000000000000000000000000006" };

describe("native requests", () => {
  it("send holder count its own query parameters", () => {
    const built = buildRequest("holder_count", "TOKEN_HOLDER_COUNT_GENERAL", subject, {});
    const cand = ALLOWLIST.holder_count!.find((m) => m.minerId === "7302")!;
    expect(built.ok && forCandidate(built.req, cand)).toEqual({ method: "GET", endpoint: "/holders", payload: { token: subject.token, chain: "base" } });
  });

  it("carry the chain from context when the intent's params have none (wash trading)", () => {
    const built = buildRequest("wash_trading", "WASH_TRADING_DETECTION_GENERAL", subject, {});
    const cand = ALLOWLIST.wash_trading!.find((m) => m.minerId === "7378")!;
    expect(built.ok && forCandidate(built.req, cand)).toEqual({ method: "GET", endpoint: "/washtrade", payload: { token: subject.token, chain: "base" } });
  });

  it("leave a canonical miner's request untouched", () => {
    const built = buildRequest("liquidity_depth", "LIQUIDITY_DEPTH_VERIFY_GENERAL", subject, { pool: "0x00000000000000000000000000000000000000aa" });
    const cand = ALLOWLIST.liquidity_depth!.find((m) => m.minerId === "7373")!;
    expect(built.ok && forCandidate(built.req, cand)).toEqual(built.ok && built.req);
  });
});
