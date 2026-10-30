// pnpm repro <verdict file>: re-run adapters and engine on a stored verdict; exit 1 on any mismatch.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reproduce, type StoredVerdict } from "@skein/engine";
import { getPolicy } from "@skein/policies";

const files = process.argv.slice(2).map((f) => resolve(process.env.INIT_CWD ?? process.cwd(), f));
if (files.length === 0) {
  console.error("usage: pnpm repro <verdict.json> [...]");
  process.exit(64);
}
let failed = 0;
for (const file of files) {
  const { stored } = JSON.parse(readFileSync(file, "utf8")) as { stored: StoredVerdict };
  const report = reproduce(stored, getPolicy(`${stored.policy.id}@${stored.policy.version}`).policy);
  console.log(`${report.ok ? "ok  " : "FAIL"} ${file} ${report.verdictHash}${report.ok ? "" : `\n     ${report.problems.join("\n     ")}`}`);
  if (!report.ok) failed++;
}
process.exit(failed ? 1 : 0);
