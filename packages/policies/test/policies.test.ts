import { describe, expect, it } from "vitest";
import { getPolicy, listPolicies, readLock } from "../src/index";

describe("policies", () => {
  it("every policy file parses and is named after its id@version", () => {
    const all = listPolicies();
    expect(all.map((p) => p.ref)).toEqual(["agent-pretrade@0.1.0", "cex-standard@0.1.0", "dex-list@0.1.0"]);
  });

  it("published policies are immutable: each file matches its locked SHA-256", () => {
    const lock = readLock();
    for (const p of listPolicies()) {
      expect(lock[p.ref], `${p.ref} is not in policies.lock.json; run pnpm policies:lock`).toBe(p.sha256);
    }
  });

  it("no locked policy has been deleted", () => {
    const refs = new Set(listPolicies().map((p) => p.ref));
    for (const ref of Object.keys(readLock())) expect(refs.has(ref), ref).toBe(true);
  });

  it("resolves a bare id to its highest version", () => {
    expect(getPolicy("cex-standard").ref).toBe("cex-standard@0.1.0");
    expect(() => getPolicy("cex-standard@9.9.9")).toThrow(/UNKNOWN_POLICY/);
  });
});
