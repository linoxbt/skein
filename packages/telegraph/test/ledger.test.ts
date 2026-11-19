import { describe, expect, it } from "vitest";
import { escrowAccount } from "../src/ledger";

// The node's answer for a funded wallet on the 2026-11-17 Diamond (shape from docs/using/escrow-inference).
const LIVE = {
  active_root: { balance: "0", charged: "0", credited: "0", epoch_id: 14 },
  address: "0xc14b8719f49165ab34e741b441ca3c6720dd6c8a",
  available: "99990000", balance: "100000000", charge_limit: "1000000000", charged: "0", credited: "0",
  deposited: "100000000", request: { status: "none" }, unbilled: "10000", withdrawn: "0",
};
const node = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("escrowAccount", () => {
  it("reads deposited, balance, available and unbilled in micro-USDC", async () => {
    expect(await escrowAccount("https://node.test/", LIVE.address, node(LIVE))).toEqual({ deposited: 100_000_000, balance: 100_000_000, available: 99_990_000, unbilled: 10_000, withdrawal: "none" });
  });
  it("refuses a node error, a bad address and a garbled amount", async () => {
    await expect(escrowAccount("https://node.test", LIVE.address, node({}, 503))).rejects.toThrow(/503/);
    await expect(escrowAccount("https://node.test", "0x123", node(LIVE))).rejects.toThrow(/bad address/);
    await expect(escrowAccount("https://node.test", LIVE.address, node({ ...LIVE, available: "lots" }))).rejects.toThrow(/not an amount/);
  });
});
