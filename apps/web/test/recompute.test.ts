import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { attestationMessage } from "@skein/engine";
import { parsePasted, recompute, sha256Hex, type RecomputeInput } from "../lib/recompute";
import type { Bom, VerdictObject } from "../lib/types";

// Real verdicts served by api.skeinlabs.site on 2026-11-12, with their BOMs and policy files.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const ATTESTER = "0x07Dee32979AE8C17415Bd6d6939bA0d815639309";
const policyYaml = (ref: string) => (fixture(`policy-${ref}`) as { yaml: string }).yaml;

function input(id: string, patch: Partial<RecomputeInput> = {}): RecomputeInput {
  const { verdict, bom } = fixture(id) as { verdict: VerdictObject; bom: Bom };
  return { verdict, bom, policyYaml: policyYaml(`${verdict.policy.id}@${verdict.policy.version}`), attester: ATTESTER, ...patch };
}
const state = (r: Awaited<ReturnType<typeof recompute>>) => Object.fromEntries(r.steps.map((s) => [s.key, s.state]));

describe("recompute in the browser", () => {
  it("reproduces live verdicts byte for byte: policy file, decision, hash, root, receipts and signature", async () => {
    for (const id of ["vrd_mwcxuujn455j283w6w5u", "vrd_mwcx9pn352700p62013h", "vrd_mwdl5p4r1k5x0b1e5948"]) {
      const r = await recompute(input(id));
      expect(state(r), id).toEqual({ policyFile: "pass", engine: "pass", decision: "pass", verdictHash: "pass", bomRoot: "pass", receipts: "pass", attestation: "pass" });
      expect(r.ok).toBe(true);
      expect(r.verdictHash.recomputed).toBe(r.verdictHash.stored);
      expect(r.bomRoot.recomputed).toBe(r.bomRoot.stored);
      expect(r.recoveredSigner?.toLowerCase()).toBe(ATTESTER.toLowerCase());
    }
  });

  it("hashes the policy file's bytes the way policies.lock.json does", async () => {
    const p = fixture("policy-dex-list@0.1.0") as { sha256: string; yaml: string };
    expect(await sha256Hex(p.yaml)).toBe(p.sha256);
  });

  it("fails, and never passes, when the served decision was edited", async () => {
    const i = input("vrd_mwcxuujn455j283w6w5u");
    const r = await recompute({ ...i, verdict: { ...i.verdict, verdict: "APPROVE", riskBps: 100 } });
    expect(r.ok).toBe(false);
    expect(state(r).decision).toBe("fail");
    // The signature was over the original decision: it no longer matches the message rebuilt from these fields.
    expect(state(r).attestation).toBe("fail");
  });

  it("fails when a finding was edited, even with the decision left alone", async () => {
    const i = input("vrd_mwcxuujn455j283w6w5u");
    const findings = i.verdict.findings.map((f, n) => (n === 0 ? { ...f, value: (f.value ?? 0) + 1 } : f));
    const r = await recompute({ ...i, verdict: { ...i.verdict, findings } });
    expect(state(r).verdictHash).toBe("fail");
    expect(r.ok).toBe(false);
  });

  it("fails when the policy file is not the sealed one", async () => {
    const i = input("vrd_mwcxuujn455j283w6w5u");
    const r = await recompute({ ...i, policyYaml: `${i.policyYaml}\n# edited\n` });
    expect(state(r).policyFile).toBe("fail");
    expect(r.ok).toBe(false);
  });

  it("fails when a receipt is dropped from the BOM", async () => {
    const i = input("vrd_mwcxuujn455j283w6w5u");
    const r = await recompute({ ...i, bom: { ...i.bom!, lines: i.bom!.lines.slice(1) } });
    expect(state(r).bomRoot).toBe("fail");
    expect(state(r).receipts).toBe("fail");
    expect(r.ok).toBe(false);
  });

  it("checks the signature against the published attester, not the signer the verdict names", async () => {
    const i = input("vrd_mwcxuujn455j283w6w5u");
    // A valid signature by some other key, naming itself as signer.
    const other = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
    const message = attestationMessage(i.verdict);
    const attestation = { scheme: "eip191" as const, signer: other.address, message, signature: await other.signMessage({ message }) };
    const r = await recompute({ ...i, verdict: { ...i.verdict, attestation } });
    expect(state(r).attestation).toBe("fail");
    expect(r.steps.find((s) => s.key === "attestation")?.detail).toContain("not the published attester");
    expect(state(await recompute({ ...i, attester: null }))).toMatchObject({ attestation: "fail" });
  });

  it("reports a missing BOM or signature as skipped, not passed", async () => {
    const i = input("vrd_mwcxuujn455j283w6w5u");
    const { attestation: _a, ...unsigned } = i.verdict;
    const r = await recompute({ ...i, bom: null, verdict: unsigned as VerdictObject });
    expect(state(r)).toMatchObject({ receipts: "skip", attestation: "skip", verdictHash: "pass" });
    // Every receipt here produced a finding, so the root rebuilds from the findings alone.
    expect(state(r).bomRoot).toBe("pass");
  });
});

describe("pasted JSON", () => {
  it("takes a bare verdict or { verdict, bom, policyYaml }", () => {
    const { verdict, bom } = fixture("vrd_mwcxuujn455j283w6w5u");
    expect(parsePasted(JSON.stringify(verdict))).toMatchObject({ verdict: { id: verdict.id }, bom: null, policyYaml: null });
    const p = parsePasted(JSON.stringify({ verdict, bom, policyYaml: "id: x" }));
    expect(p.bom?.lines.length).toBe(bom.lines.length);
    expect(p.policyYaml).toBe("id: x");
  });

  it("explains what is wrong with anything else", () => {
    expect(() => parsePasted("{")).toThrow(/Not JSON/);
    expect(() => parsePasted("[]")).toThrow(/verdict object/);
    expect(() => parsePasted('{"id":"vrd_x"}')).toThrow(/no "verdict"/);
  });
});
