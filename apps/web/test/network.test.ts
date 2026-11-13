import { describe, expect, it } from "vitest";
import { networkLabel, networkName, STATIC_NETWORK } from "../lib/network";

describe("network label", () => {
  it("names the Telegraph testnet before the API answers, and when it never does", () => {
    expect(networkLabel(undefined)).toEqual(STATIC_NETWORK);
    expect(STATIC_NETWORK.long).toBe("Telegraph testnet");
    expect(networkLabel(null)).toMatchObject({ short: "Testnet", tone: "offline" });
    expect(networkLabel(null).long).toMatch(/^Telegraph testnet/);
  });

  it("maps CAIP-2 ids to readable names", () => {
    expect(networkLabel("eip155:11155111")).toEqual({ short: "Testnet", long: "Telegraph testnet (Sepolia)", tone: "live" });
    expect(networkLabel("testnet").long).toBe("Telegraph testnet (Sepolia)");
    expect(networkName("eip155:84532")).toBe("Base Sepolia testnet");
    expect(networkLabel("eip155:8453")).toMatchObject({ short: "Base mainnet", long: "Base mainnet" });
    expect(networkLabel("eip155:999")).toMatchObject({ short: "EVM chain 999", long: "EVM chain 999 (eip155:999)" });
  });

  it("says a simulated node is not evidence", () => {
    expect(networkLabel("simulated")).toEqual({ short: "Simulated", long: "Simulated · not evidence", tone: "simulated" });
  });
});
