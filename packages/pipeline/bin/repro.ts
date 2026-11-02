// pnpm repro <verdict file or directory> [...]: re-run adapters and the engine
// that sealed each stored verdict; exit 1 on any mismatch. CI runs it over
// every committed verdict fixture (eval/verdicts/).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { reproduce, type StoredVerdict } from "@skein/engine";
import { getPolicy } from "@skein/policies";

const args = process.argv.slice(2).map((f) => resolve(process.env.INIT_CWD ?? process.cwd(), f));
if (args.length === 0) {
  console.error("usage: pnpm repro <verdict.json | dir> [...]");
  process.exit(64);
}
const files = args.flatMap((p) =>
  statSync(p).isDirectory()
    ? readdirSync(p).filter((f) => f.endsWith(".json")).sort().map((f) => join(p, f))
    : [p],
);
let failed = 0;
for (const file of files) {
  const { stored } = JSON.parse(readFileSync(file, "utf8")) as { stored: StoredVerdict };
  const record = getPolicy(`${stored.policy.id}@${stored.policy.version}`);
  const report = reproduce(stored, record.policy, { policySha256: record.sha256 });
  console.log(`${report.ok ? "ok  " : "FAIL"} ${file} ${report.verdictHash}${report.ok ? "" : `\n     ${report.problems.join("\n     ")}`}`);
  if (!report.ok) failed++;
}
console.log(`${files.length - failed}/${files.length} reproduced`);
process.exit(failed ? 1 : 0);
