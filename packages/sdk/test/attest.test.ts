import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { attestationMessage, verifyAttestation } from "../src/attest";

const account = privateKeyToAccount(`0x${"cd".repeat(32)}`);
const base = {
  id: "vrd_test",
  subject: { chainId: 8453, token: "0x4200000000000000000000000000000000000006" },
  verdict: "APPROVE",
  riskBps: 1200,
  confidenceBps: 8100,
  policy: { id: "dex-list", version: "0.1.0" },
  engineVersion: "0.2.0",
  verdictHash: `0x${"11".repeat(32)}`,
  bom: { root: `0x${"22".repeat(32)}` },
  cost: { priceUsdc: 0.25, upstreamUsdc: 0.06 },
  network: "testnet",
  createdAt: "2026-11-05T10:00:00.000Z",
};
const signed = async () => {
  const message = attestationMessage(base);
  return { ...base, attestation: { scheme: "eip191" as const, signer: account.address, message, signature: await account.signMessage({ message }) } };
};

describe("verifyAttestation", () => {
  it("accepts a verdict signed by the expected attester", async () => {
    expect(await verifyAttestation(await signed(), { signer: account.address })).toEqual({ ok: true, signer: account.address, problems: [] });
  });

  it("rejects a verdict whose outcome was edited after signing, even with the message left intact", async () => {
    const v = { ...(await signed()), verdict: "REJECT" };
    const r = await verifyAttestation(v, { signer: account.address });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/does not match/);
  });

  it("rejects a signature from anyone else", async () => {
    const r = await verifyAttestation(await signed(), { signer: privateKeyToAccount(`0x${"ef".repeat(32)}`).address });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/not the expected/);
  });

  it("says so when there is nothing to check", async () => {
    expect((await verifyAttestation(base, { signer: account.address })).ok).toBe(false);
  });
});
