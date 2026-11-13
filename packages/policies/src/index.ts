import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parsePolicy, type Policy } from "@skein/engine";
import { parse } from "yaml";

export const POLICY_DIR = fileURLToPath(new URL("../policies/", import.meta.url));
export const LOCK_FILE = fileURLToPath(new URL("../policies.lock.json", import.meta.url));

export interface PolicyRecord {
  ref: string;
  policy: Policy;
  yaml: string;
  /**
   * The YAML document as written, before the schema filled in defaults. Pass
   * it to reproduce() (policySource) so each engine applies the schema it
   * was sealed under (@skein/engine, engines.ts).
   */
  source: unknown;
  /** SHA-256 of the file's raw bytes. */
  sha256: string;
}

/**
 * Parsed files, reused while each file's size and modification time are
 * unchanged: a request no longer re-reads, re-hashes and re-parses every
 * policy. An edited file has a new mtime, so it is loaded (and re-checked
 * against the lock) again.
 */
const cache = new Map<string, { stamp: string; record: PolicyRecord }>();
const stampOf = (path: string) => {
  const s = statSync(path);
  return `${s.size}:${s.mtimeMs}`;
};

function load(file: string): PolicyRecord {
  const path = `${POLICY_DIR}${file}`;
  const stamp = stampOf(path);
  const hit = cache.get(file);
  if (hit && hit.stamp === stamp) return hit.record;
  const record = loadUncached(file);
  cache.set(file, { stamp, record });
  return record;
}

function loadUncached(file: string): PolicyRecord {
  const bytes = readFileSync(`${POLICY_DIR}${file}`);
  const yaml = bytes.toString("utf8");
  const source = parse(yaml) as unknown;
  const policy = parsePolicy(source);
  const ref = `${policy.id}@${policy.version}`;
  if (file !== `${ref}.yaml`) throw new Error(`${file} declares ${ref}; the file must be named ${ref}.yaml`);
  return { ref, policy, yaml, source, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** Every policy file, published or not, unchecked against the lock. For the lock script and tests. */
export function listAllPolicyFiles(): PolicyRecord[] {
  return readdirSync(POLICY_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map(load);
}

/**
 * Published policies only: each file's bytes must hash to its entry in
 * policies.lock.json. An edited file throws (a change is a new version), and
 * a file with no entry is an unpublished draft that verdicts may not use.
 */
export function listPolicies(): PolicyRecord[] {
  // The lock and every file are still stat'ed on each call, so an edited file
  // is caught at once; only the checking and filtering are reused while
  // nothing on disk changed.
  const files = listAllPolicyFiles();
  const stamp = [stampOf(LOCK_FILE), ...files.map((p) => `${p.ref}:${cache.get(`${p.ref}.yaml`)?.stamp ?? ""}`)].join("|");
  if (published?.stamp === stamp) return [...published.records];
  const lock = readLock();
  const records = files.filter((p) => {
    const want = lock[p.ref];
    if (want === undefined) return false;
    if (want !== p.sha256) throw new Error(`POLICY_TAMPERED ${p.ref}: file sha256 ${p.sha256} is not the published ${want}`);
    return true;
  });
  published = { stamp, records };
  return [...records];
}
let published: { stamp: string; records: PolicyRecord[] } | null = null;

/** Resolves "id@version", or "id" for the highest version. */
export function getPolicy(ref: string): PolicyRecord {
  const all = listPolicies();
  if (ref.includes("@")) {
    const hit = all.find((p) => p.ref === ref);
    if (!hit) throw new Error(`UNKNOWN_POLICY ${ref}`);
    return hit;
  }
  const versions = all.filter((p) => p.policy.id === ref);
  if (versions.length === 0) throw new Error(`UNKNOWN_POLICY ${ref}`);
  const num = (v: string) => v.split(".").map(Number) as [number, number, number];
  return versions.sort((a, b) => {
    const [x, y] = [num(a.policy.version), num(b.policy.version)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  })[versions.length - 1]!;
}

let lockCache: { stamp: string; lock: Record<string, string> } | null = null;
export function readLock(): Record<string, string> {
  const stamp = stampOf(LOCK_FILE);
  if (lockCache?.stamp !== stamp) lockCache = { stamp, lock: JSON.parse(readFileSync(LOCK_FILE, "utf8")) as Record<string, string> };
  return { ...lockCache.lock };
}
