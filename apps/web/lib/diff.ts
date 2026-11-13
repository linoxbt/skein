export type DiffLine = { kind: "same" | "add" | "del"; text: string; a?: number; b?: number };

/**
 * A line diff of two texts (longest common subsequence). Policy files are a
 * few dozen lines, so the quadratic table is small; a file past 2,000 lines
 * is refused rather than diffed slowly.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.replace(/\n$/, "").split("\n");
  const b = after.replace(/\n$/, "").split("\n");
  if (a.length > 2000 || b.length > 2000) throw new Error("too long to diff");
  const n = a.length;
  const m = b.length;
  // lcs[i][j]: the LCS length of a[i..] and b[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]!, a: i + 1, b: j + 1 });
      i++;
      j++;
    } else if (i < n && (j === m || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      // A removal before the addition that replaces it.
      out.push({ kind: "del", text: a[i]!, a: i + 1 });
      i++;
    } else {
      out.push({ kind: "add", text: b[j]!, b: j + 1 });
      j++;
    }
  }
  return out;
}

/** Semver-ish order for policy versions (0.10.0 after 0.9.0). */
export function compareVersions(x: string, y: string): number {
  const p = (v: string) => v.split(/[.-]/).map((s) => (/^\d+$/.test(s) ? Number(s) : s));
  const [a, b] = [p(x), p(y)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const [u, v] = [a[i] ?? 0, b[i] ?? 0];
    if (u === v) continue;
    if (typeof u === "number" && typeof v === "number") return u - v;
    return String(u) < String(v) ? -1 : 1;
  }
  return 0;
}
