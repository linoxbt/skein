// pnpm --filter @skein/eval eval run <cases.json> --out <dir> [--split holdout] [--policy dex-list] --live --yes --max-total-usdc <n>
// pnpm --filter @skein/eval eval report <cases.json> <runs dir> [--split holdout]
//
// run buys one live verdict per case (real Telegraph inputs, paid from the
// purchaser's escrow) and stores it; it refuses without --live --yes and stops
// before the total would pass --max-total-usdc. report scores Skein and the
// baselines on stored runs, with bootstrap intervals, as Markdown.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { getPolicy } from "@skein/policies";
import { dexScreenerResolver, loadCatalogue, runVerdict } from "@skein/pipeline";
import { CHECK_INTENTS, networkFromEnv, TelegraphClient, viemSigner } from "@skein/telegraph";
import { casesFileSchema, type Case } from "./cases";
import { answerFor, bootstrap, metrics, SYSTEMS, type Run } from "./metrics";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    split: { type: "string" },
    policy: { type: "string", default: "dex-list" },
    live: { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    "max-total-usdc": { type: "string" },
  },
});
const [cmd, casesPath, runsDir] = positionals;
const cwd = process.env.INIT_CWD ?? process.cwd();
if (!cmd || !casesPath) {
  console.error("usage: eval run <cases.json> --out <dir> --live --yes --max-total-usdc <n> | eval report <cases.json> <runs dir>");
  process.exit(64);
}
const file = casesFileSchema.parse(JSON.parse(readFileSync(resolve(cwd, casesPath), "utf8")));
const cases: Case[] = file.cases.filter((c) => !values.split || c.split === values.split);

if (cmd === "run") {
  if (!values.live || !values.yes) throw new Error("run buys real verdicts: pass --live --yes (and --max-total-usdc)");
  const cap = Number(values["max-total-usdc"]);
  if (!(cap > 0)) throw new Error("--max-total-usdc must be a positive number");
  const key = process.env.PURCHASER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) throw new Error("PURCHASER_PRIVATE_KEY is required");
  const out = resolve(cwd, values.out ?? "eval/runs");
  mkdirSync(out, { recursive: true });
  const record = getPolicy(values.policy!);
  const client = new TelegraphClient({ network: networkFromEnv(), signer: viemSigner(key), maxUusdcPerCall: 50_000 });
  const catalogue = await loadCatalogue(client, Object.values(CHECK_INTENTS).filter((i): i is string => !!i));
  let spent = 0;
  for (const c of cases) {
    if (spent + Math.round(record.policy.budget.max_usdc * 1e6) > cap * 1e6) {
      console.error(`stopping: the next verdict could pass the ${cap} USDC cap (spent ${spent / 1e6})`);
      break;
    }
    const t0 = Date.now();
    const run = await runVerdict(
      { policy: record.policy, policySha256: record.sha256, subject: { chainId: c.chainId, token: c.token.toLowerCase() }, context: c.context },
      { client, catalogue, priceUusdc: 250_000, resolver: dexScreenerResolver() },
    );
    if (!run.ok) {
      console.error(`${c.id}: refused (${run.plan.refusal.code})`);
      continue;
    }
    spent += run.purchases.reduce((a, p) => a + p.amountUusdc, 0);
    writeFileSync(join(out, `${c.id}.json`), `${JSON.stringify({ caseId: c.id, policyRef: record.ref, wallMs: Date.now() - t0, verdict: run.verdict, purchases: run.purchases, stored: run.stored }, null, 2)}\n`);
    console.log(`${c.id}: ${run.verdict.decision.verdict} (${c.label})`);
  }
  console.log(`spent ${spent / 1e6} USDC`);
} else if (cmd === "report") {
  if (!runsDir) throw new Error("report needs a runs directory");
  const dir = resolve(cwd, runsDir);
  const runs: Run[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (!cases.some((c) => c.id === r.caseId)) continue;
    runs.push({
      caseId: r.caseId,
      policy: getPolicy(r.policyRef).policy,
      findings: r.verdict.findings,
      verdict: r.verdict.decision.verdict,
      coverageBps: r.verdict.decision.coverageBps,
      purchases: r.purchases,
      wallMs: r.wallMs,
    });
  }
  console.log(report(file.kind, cases, runs));
} else {
  throw new Error(`unknown command ${cmd}`);
}

function report(kind: string, cs: Case[], runs: Run[]): string {
  const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
  const ci = (v: [number, number] | null) => (v ? ` (95% CI ${pct(v[0])}–${pct(v[1])})` : "");
  const lines = [
    `# Skein benchmark${values.split ? ` (${values.split})` : ""}`,
    "",
    kind === "example" ? "> EXAMPLE CASES: these exercise the harness. They are not results and must not be reported as such.\n" : "",
    `${runs.length} of ${cs.length} cases have a run. ${runs.length < 30 ? `A sample of ${runs.length} is small; read the intervals, not the point estimates.` : ""}`,
    "",
    "| System | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | p50 / p95 latency | Coverage |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const sys of SYSTEMS) {
    const answers = runs.map((r) => answerFor(sys, r));
    const m = metrics(cs, answers);
    lines.push(
      `| ${sys} | ${pct(m.falseApproveRate)}${ci(bootstrap(cs, answers, (x) => x.falseApproveRate))} | ${pct(m.rejectPrecision)} | ${pct(m.rejectRecall)}${ci(bootstrap(cs, answers, (x) => x.rejectRecall))} | ${pct(m.escalateRate)} | ${pct(m.abstainRate)} | $${m.costPerVerdictUsdc.toFixed(3)} | ${m.p50LatencyMs} / ${m.p95LatencyMs} ms | ${pct(m.meanCoverage)} |`,
    );
  }
  lines.push("", "Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.");
  return lines.join("\n");
}
