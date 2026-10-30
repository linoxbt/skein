import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parsePolicy, type Policy } from "@skein/engine";
import { parse } from "yaml";

export const POLICY_DIR = fileURLToPath(new URL("../policies/", import.meta.url));
export const LOCK_FILE = fileURLToPath(new URL("../policies.lock.json", import.meta.url));

export interface PolicyRecord {
  ref: string;
  policy: Policy;
  yaml: string;
  /** SHA-256 of the file's raw bytes. */
  sha256: string;
}

function load(file: string): PolicyRecord {
  const bytes = readFileSync(`${POLICY_DIR}${file}`);
  const yaml = bytes.toString("utf8");
  const policy = parsePolicy(parse(yaml));
  const ref = `${policy.id}@${policy.version}`;
  if (file !== `${ref}.yaml`) throw new Error(`${file} declares ${ref}; the file must be named ${ref}.yaml`);
  return { ref, policy, yaml, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function listPolicies(): PolicyRecord[] {
  return readdirSync(POLICY_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map(load);
}

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

export function readLock(): Record<string, string> {
  return JSON.parse(readFileSync(LOCK_FILE, "utf8")) as Record<string, string>;
}
