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
import { cex, cleanCex, f } from "./helpers";

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
  it("is the leaf hash for one receipt", () => {
    expect(merkleRoot([r(1)])).toBe(`0x${bytesToHex(keccak_256(hexToBytes(r(1).slice(2))))}`);
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
    const findings = [...cleanCex({ sanctions: null }), adapterFor("sanctions", "0.1.0").adapt(raw, ctx)];
    const sealed = evaluate(policy, subject, findings);
    const others = findings.filter((x) => x.check !== "sanctions");
    const stored: StoredVerdict = {
      engineVersion: sealed.engineVersion,
      policy: sealed.policy,
      subject,
      findings: sealed.findings,
      purchases: [{ ...ctx, rawResult: raw }],
      unpurchased: others, // stand-ins for the other checks' stored findings
      verdictHash: sealed.verdictHash,
      bomRoot: sealed.bom.root,
    };
    expect(reproduce(stored, policy)).toMatchObject({ ok: true, problems: [] });

    const tampered = { ...stored, purchases: [{ ...ctx, rawResult: { matched: "yes" } }] };
    const report = reproduce(tampered, policy);
    expect(report.ok).toBe(false);
    expect(report.problems).toContain("findings re-derived from raw answers differ from the stored findings");
    expect(report.problems).toContain("verdict hash mismatch");
  });
});
