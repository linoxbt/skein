import { describe, expect, it } from "vitest";
import { parsePolicyV1 } from "@skein/engine";
import { getPolicy, listAllPolicyFiles, listPolicies, readLock } from "../src/index";

describe("policies", () => {
  it("every policy file parses and is named after its id@version", () => {
    const all = listPolicies();
    expect(all.map((p) => p.ref)).toEqual(["agent-pretrade@0.1.0", "agent-pretrade@0.2.0", "agent-pretrade@0.3.0", "cex-standard@0.1.0", "dex-list@0.1.0", "dex-list@0.2.0"]);
  });

  it("published policies are immutable: each file matches its locked SHA-256", () => {
    const lock = readLock();
    for (const p of listPolicies()) {
      expect(lock[p.ref], `${p.ref} is not in policies.lock.json; run pnpm policies:lock`).toBe(p.sha256);
    }
  });

  it("no locked policy has been deleted", () => {
    const refs = new Set(listAllPolicyFiles().map((p) => p.ref));
    for (const ref of Object.keys(readLock())) expect(refs.has(ref), ref).toBe(true);
  });

  it("every policy file is published (in the lock), so none is silently ignored", () => {
    expect(listAllPolicyFiles().map((p) => p.ref)).toEqual(listPolicies().map((p) => p.ref));
  });

  it("the live schema reads every published policy exactly as the frozen v1 schema does (audit L3)", () => {
    // Engines 0.1.0 to 0.4.0 decided with v1's defaults; a live schema that reads a
    // published file differently needs a new schema version, not an edit.
    for (const p of listPolicies()) expect(p.policy, p.ref).toEqual(parsePolicyV1(p.source));
  });

  it("reuses the checked list while nothing on disk changed", () => {
    expect(listPolicies()).toEqual(listPolicies());
    expect(listPolicies()).not.toBe(listPolicies()); // a copy: callers cannot edit the cache
  });

  it("resolves a bare id to its highest version", () => {
    expect(getPolicy("cex-standard").ref).toBe("cex-standard@0.1.0");
    expect(() => getPolicy("cex-standard@9.9.9")).toThrow(/UNKNOWN_POLICY/);
    // A new version reaches callers of the bare id; a pinned version never changes.
    expect(getPolicy("dex-list").ref).toBe("dex-list@0.2.0");
    expect(getPolicy("dex-list@0.1.0").policy.optional).not.toContain("code_review");
    expect(getPolicy("dex-list@0.2.0").policy.optional).toContain("code_review");
  });
});
