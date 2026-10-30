// Records the SHA-256 of newly published policies. Published entries are never
// rewritten: a change to a policy is a new version.
import { writeFileSync } from "node:fs";
import { LOCK_FILE, listPolicies, readLock } from "./index";

const lock = readLock();
let added = 0;
for (const p of listPolicies()) {
  const known = lock[p.ref];
  if (known && known !== p.sha256) {
    console.error(`${p.ref} changed after publication; publish a new version instead`);
    process.exit(1);
  }
  if (!known) {
    lock[p.ref] = p.sha256;
    added++;
  }
}
const sorted = Object.fromEntries(Object.entries(lock).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(LOCK_FILE, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`policies.lock.json: ${added} added, ${Object.keys(sorted).length} total`);
