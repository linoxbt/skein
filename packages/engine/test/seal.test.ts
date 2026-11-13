import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  evaluate,
  InvalidSubjectError,
  merkleRoot,
  parseSubject,
  reproduce,
  adapterFor,
  toChecksumAddress,
  ZERO_HASH,
  type StoredVerdict,
} from "../src";
import { boughtCex, cex, cleanCex, f } from "./helpers";

const subject = { chainId: 8453, token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" };
const r = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

describe("canonical JSON", () => {
  it("sorts keys, drops undefined, keeps arrays in order", () => {
    expect(canonicalJson({ b: 1, a: [3, 1, { d: undefined, c: "x" }], z: undefined })).toBe('{"a":[3,1,{"c":"x"}],"b":1}');
  });
  it("refuses non-finite numbers", () => {
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
    expect(() => canonicalJson({ x: Infinity })).toThrow();
  });
});

describe("merkle root", () => {
  it("is the zero hash for no receipts", () => {
    expect(merkleRoot([])).toBe(ZERO_HASH);
  });
  it("is the 0x00-prefixed leaf hash for one receipt", () => {
    expect(merkleRoot([r(1)])).toBe(`0x${bytesToHex(keccak_256(hexToBytes(`00${r(1).slice(2)}`)))}`);
  });
  it("cannot be forged with a second preimage: leaves and nodes are domain-separated", () => {
    const leaf = (x: string) => keccak_256(hexToBytes(`00${x.slice(2)}`));
    const [a, b] = [leaf(r(1)), leaf(r(2))];
    const [lo, hi] = bytesToHex(a) < bytesToHex(b) ? [a, b] : [b, a];
    // Under 0.1.0, a 64-byte "receipt" lo‖hi had the same root as {r1, r2}; now it is refused outright.
    expect(() => merkleRoot([`0x${bytesToHex(lo)}${bytesToHex(hi)}`])).toThrow(/32-byte/);
    expect(() => merkleRoot(["not-a-hash"])).toThrow(/32-byte/);
  });
  it("ignores order, duplicates and hex case", () => {
    const a = merkleRoot([r(1), r(2), r(3)]);
    expect(merkleRoot([r(3), r(1), r(2), r(2)])).toBe(a);
    expect(merkleRoot([r(3).toUpperCase().replace("0X", "0x"), r(1), r(2)])).toBe(a);
    expect(merkleRoot([r(1), r(2)])).not.toBe(a);
  });
});

describe("subject", () => {
  it("accepts a valid checksum or a single-case address and lowercases it", () => {
    expect(parseSubject({ chainId: 8453, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }).token).toBe(subject.token);
    expect(parseSubject({ chainId: 1, token: subject.token }).token).toBe(subject.token);
    expect(toChecksumAddress(subject.token)).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  });
  it("rejects a bad checksum, an unsupported chain and junk", () => {
    expect(() => parseSubject({ chainId: 8453, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02914".replace("f4c7", "F4c7") })).toThrow(InvalidSubjectError);
    expect(() => parseSubject({ chainId: 137, token: subject.token })).toThrow(/unsupported chain/);
    expect(() => parseSubject({ chainId: 1, token: "0x1234" })).toThrow(InvalidSubjectError);
    expect(() => parseSubject({ chainId: 1, token: `0x${"0".repeat(40)}` })).toThrow(/zero address/);
  });
});

describe("evaluate and seal", () => {
  it("gives the same hash for the same findings in any order", () => {
    const findings = cleanCex();
    const a = evaluate(cex(), subject, findings);
    const b = evaluate(cex(), { ...subject, token: subject.token.toUpperCase().replace("0X", "0x") }, [...findings].reverse());
    expect(b.verdictHash).toBe(a.verdictHash);
    expect(b.bom).toEqual(a.bom);
    expect(a.bom.items).toBe(8);
    expect(a.verdictHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("changes the hash when any finding changes", () => {
    const a = evaluate(cex(), subject, cleanCex());
    const b = evaluate(cex(), subject, cleanCex({ social_bots: f("social_bots", "PASS", { confidence: 0.81 }) }));
    expect(b.verdictHash).not.toBe(a.verdictHash);
  });

  it("writes a one-line summary from structured reasons only", () => {
    const v = evaluate(cex(), subject, cleanCex({ sanctions: f("sanctions", "ERROR") }));
    expect(v.summary).toBe("Abstained: required check sanctions is ERROR.");
  });
});

describe("reproduce", () => {
  it("re-derives findings from raw answers with the recorded adapter version and matches the stored hash", () => {
    const policy = cex();
    const ctx = { check: "sanctions" as const, adapterVersion: "0.1.0", sourceGroup: "opensanctions", minerId: "78021", receiptHash: r(99) };
    const raw = { matched: "no match", match_score: 0.1 };
    // Recorded with a superseded adapter version: it must still replay.
    const bought = boughtCex(subject);
    const others = bought.purchases.filter((p) => p.check !== "sanctions");
    const findings = [...bought.findings.filter((x) => x.check !== "sanctions"), adapterFor("sanctions", "0.1.0").adapt(raw, ctx)];
    const sealed = evaluate(policy, subject, findings);
    const stored: StoredVerdict = {
      engineVersion: sealed.engineVersion,
      policy: sealed.policy,
      subject,
      findings: sealed.findings,
      purchases: [...others, { ...ctx, rawResult: raw }],
      unpurchased: [],
      verdictHash: sealed.verdictHash,
      bomRoot: sealed.bom.root,
    };
    expect(reproduce(stored, policy)).toMatchObject({ ok: true, problems: [] });

    const tampered = { ...stored, purchases: [...others, { ...ctx, rawResult: { matched: "yes" } }] };
    const report = reproduce(tampered, policy);
    expect(report.ok).toBe(false);
    expect(report.problems).toContain("findings re-derived from raw answers differ from the stored findings");
    expect(report.problems).toContain("verdict hash mismatch");
  });
});

describe("replay across engine versions", () => {
  it("replays a verdict with the engine that sealed it, including the frozen 0.1.0", async () => {
    const { evaluate: evaluate010 } = await import("../src/frozen/v0_1_0/seal");
    const policy = cex();
    const { findings, purchases } = boughtCex(subject);
    const old = evaluate010(policy, subject, findings);
    expect(old.engineVersion).toBe("0.1.0");
    const stored: StoredVerdict = { engineVersion: "0.1.0", policy: old.policy, subject, findings: old.findings, purchases, verdictHash: old.verdictHash, bomRoot: old.bom.root };
    expect(reproduce(stored, policy)).toMatchObject({ ok: true, verdictHash: old.verdictHash });
    // The current engine seals the same findings differently (new Merkle tree, policy hash).
    expect(evaluate(policy, subject, findings).verdictHash).not.toBe(old.verdictHash);
    expect(reproduce({ ...stored, engineVersion: "9.9.9" }, policy).problems[0]).toMatch(/no engine 9\.9\.9/);
  });

  it("catches a served decision that disagrees with its own hash", () => {
    const policy = cex();
    const { findings, purchases } = boughtCex(subject);
    const sealed = evaluate(policy, subject, findings, undefined, { policySha256: "ab".repeat(32) });
    const stored: StoredVerdict = {
      engineVersion: sealed.engineVersion, policy: sealed.policy, subject, findings: sealed.findings, purchases, verdictHash: sealed.verdictHash, bomRoot: sealed.bom.root,
      decision: { verdict: "APPROVE", riskBps: sealed.decision.riskBps, confidenceBps: sealed.decision.confidenceBps },
    };
    expect(reproduce(stored, policy, { policySha256: "ab".repeat(32) }).ok).toBe(sealed.decision.verdict === "APPROVE");
    const tampered = reproduce({ ...stored, decision: { ...stored.decision!, verdict: "REJECT" } }, policy);
    expect(tampered.problems.join(" ")).toMatch(/served verdict REJECT/);
    expect(reproduce(stored, policy, { policySha256: "cd".repeat(32) }).problems.join(" ")).toMatch(/policy file differs/);
  });

  it("requires the BOM's receipts to be exactly the purchases' receipts", () => {
    const policy = cex();
    const findings = cleanCex();
    const receipts = findings.map((x) => x.evidence?.receiptHash).filter((x): x is string => !!x);
    const sealed = evaluate(policy, subject, findings, receipts);
    const purchases = findings.map((x) => ({ check: x.check, adapterVersion: "0.1.0", rawResult: null, sourceGroup: x.sourceGroup, receiptHash: x.evidence?.receiptHash }));
    const base: StoredVerdict = { engineVersion: sealed.engineVersion, policy: sealed.policy, subject, findings: sealed.findings, verdictHash: sealed.verdictHash, bomRoot: sealed.bom.root, receipts };
    const extra = reproduce({ ...base, purchases: purchases.slice(1), receipts }, policy);
    expect(extra.problems.join(" ")).toMatch(/belong to no purchase/);
  });
});

describe("findings without a purchase (audit M1)", () => {
  const policy = cex();
  const base = () => {
    const { findings, purchases } = boughtCex(subject);
    const keep = purchases.filter((p) => p.check !== "code_review");
    const unpurchased = [{ check: "code_review" as const, status: "UNAVAILABLE" as const, severity: 0 as const, confidence: 0, sourceGroup: "none", notes: ["no_repo_url"] }];
    const all = [...findings.filter((x) => x.check !== "code_review"), ...unpurchased];
    const sealed = evaluate(policy, subject, all);
    const stored: StoredVerdict = { engineVersion: sealed.engineVersion, policy: sealed.policy, subject, findings: sealed.findings, purchases: keep, unpurchased, verdictHash: sealed.verdictHash, bomRoot: sealed.bom.root };
    return { stored, all, keep };
  };

  it("accepts a non-answer for a check that was not bought", () => {
    expect(reproduce(base().stored, policy)).toMatchObject({ ok: true, problems: [] });
  });

  it("refuses an answer that no purchase stands behind, even one that reseals consistently", () => {
    const { all, keep } = base();
    // A forged PASS for the code review, sealed as if it were real: the hash matches, the evidence does not.
    const forged = { ...all.find((x) => x.check === "code_review")!, status: "PASS" as const, confidence: 0.9, notes: [] };
    const findings = [...all.filter((x) => x.check !== "code_review"), forged];
    const sealed = evaluate(policy, subject, findings);
    const stored: StoredVerdict = { engineVersion: sealed.engineVersion, policy: sealed.policy, subject, findings: sealed.findings, purchases: keep, unpurchased: [forged], verdictHash: sealed.verdictHash, bomRoot: sealed.bom.root };
    const report = reproduce(stored, policy);
    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toMatch(/unpurchased code_review PASS: only non-answers and a list screen/);
    // Without purchase records at all, every answered finding is unpurchased.
    expect(reproduce({ ...stored, purchases: undefined, unpurchased: undefined }, policy).ok).toBe(false);
  });

  it("accepts the OFAC list screen only from a snapshot Skein ships, when told which", () => {
    const { all, keep } = base();
    const sha = "ab".repeat(32);
    const listHit = {
      check: "sanctions" as const, status: "FAIL" as const, severity: 3 as const, confidence: 1, sourceGroup: "ofac-sdn@2026-11-11", notes: ["ofac_sdn_address_match"], adapterVersion: "ofac-sdn-1",
      evidence: { list: "OFAC SDN", listSha256: sha, matches: [{ field: "deployer", address: "0x01", sdnUid: "1" }] },
    };
    const findings = [...all.filter((x) => x.check !== "sanctions"), listHit];
    const sealed = evaluate(policy, subject, findings);
    expect(sealed.decision.verdict).toBe("REJECT");
    const stored: StoredVerdict = {
      engineVersion: sealed.engineVersion, policy: sealed.policy, subject, findings: sealed.findings,
      purchases: keep.filter((p) => p.check !== "sanctions"), unpurchased: [all.find((x) => x.check === "code_review")!, listHit], verdictHash: sealed.verdictHash, bomRoot: sealed.bom.root,
    };
    expect(reproduce(stored, policy).ok).toBe(true);
    expect(reproduce(stored, policy, { knownLists: { "OFAC SDN": [sha] } }).ok).toBe(true);
    expect(reproduce(stored, policy, { knownLists: { "OFAC SDN": ["cd".repeat(32)] } }).problems.join(" ")).toMatch(/not one Skein ships/);
  });
});

describe("mode in the verdict hash (engine 0.4.0, audit L4)", () => {
  it("a simulated verdict cannot be relabelled live", () => {
    const policy = cex();
    const { findings, purchases } = boughtCex(subject);
    const sim = evaluate(policy, subject, findings, undefined, { mode: "simulated" });
    expect(sim.verdictHash).not.toBe(evaluate(policy, subject, findings).verdictHash);
    const stored: StoredVerdict = { engineVersion: sim.engineVersion, policy: sim.policy, subject, findings: sim.findings, purchases, verdictHash: sim.verdictHash, bomRoot: sim.bom.root, mode: "simulated" };
    expect(reproduce(stored, policy).ok).toBe(true);
    expect(reproduce({ ...stored, mode: "live" }, policy).problems).toContain("verdict hash mismatch");
    expect(reproduce({ ...stored, mode: undefined }, policy).problems).toContain("verdict hash mismatch");
  });
});

describe("frozen engines parse the policy with their own schema (audit L3)", () => {
  it("a changed live default cannot change a replay when the policy source is given", async () => {
    const { readFileSync } = await import("node:fs");
    const { parse } = await import("yaml");
    const { evaluateWith } = await import("../src");
    const source = parse(readFileSync(new URL("../../policies/policies/cex-standard@0.1.0.yaml", import.meta.url), "utf8"));
    const policy = cex();
    const { findings } = boughtCex(subject, { wash_trading: { verdict: "wash_trading", wash_volume_pct: 70 } });
    const sealed = evaluateWith("0.3.0", policy, subject, findings);
    // As if a later live schema changed a default the policy file does not set.
    const drifted = { ...policy, decision: { ...policy.decision, agreement_penalty: 0.9 } };
    expect(evaluateWith("0.3.0", drifted, subject, findings).verdictHash).not.toBe(sealed.verdictHash);
    expect(evaluateWith("0.3.0", drifted, subject, findings, undefined, { policySource: source }).verdictHash).toBe(sealed.verdictHash);
  });
});
