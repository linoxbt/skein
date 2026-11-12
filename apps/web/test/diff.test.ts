import { describe, expect, it } from "vitest";
import { compareVersions, lineDiff } from "../lib/diff";

describe("policy diff", () => {
  it("marks added, removed and unchanged lines with their line numbers", () => {
    const d = lineDiff("id: x\nversion: 0.1.0\nmin_coverage: 0.8\n", "id: x\nversion: 0.2.0\nmin_coverage: 0.8\ncode_review: 0.07\n");
    expect(d).toEqual([
      { kind: "same", text: "id: x", a: 1, b: 1 },
      { kind: "del", text: "version: 0.1.0", a: 2 },
      { kind: "add", text: "version: 0.2.0", b: 2 },
      { kind: "same", text: "min_coverage: 0.8", a: 3, b: 3 },
      { kind: "add", text: "code_review: 0.07", b: 4 },
    ]);
  });

  it("is all unchanged for the same file, and rebuilds both sides", () => {
    const a = "a\nb\nc";
    const b = "x\nb\ny\nz";
    expect(lineDiff(a, a).every((l) => l.kind === "same")).toBe(true);
    const d = lineDiff(a, b);
    expect(d.filter((l) => l.kind !== "add").map((l) => l.text).join("\n")).toBe(a);
    expect(d.filter((l) => l.kind !== "del").map((l) => l.text).join("\n")).toBe(b);
  });

  it("orders versions numerically", () => {
    expect(["0.10.0", "0.2.0", "0.9.1"].sort(compareVersions)).toEqual(["0.2.0", "0.9.1", "0.10.0"]);
  });
});
