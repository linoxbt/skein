// pnpm --filter @skein/eval eval run <cases.json> --out <dir> [--split holdout] [--policy dex-list] --live --yes --max-total-usdc <n>
// pnpm --filter @skein/eval eval report <cases.json> <runs dir> [--split holdout]
// pnpm --filter @skein/eval eval rescore <cases.json> <runs dir> --split tune   re-grade stored tune runs with the
//   current adapters, from the answers already bought (free; tune only: a holdout run is scored as it was bought)
// pnpm --filter @skein/eval eval import <cases.json> --out <dir>   prospective cases: fetch the verdict bought
//   before the outcome (its verdictId) from the Skein API (verdicts are public; SKEIN_API_KEY is optional), rather than buy a new one
//
// run buys one live verdict per case (real Telegraph inputs, paid from the
// purchaser's escrow) and stores it; it refuses without --live --yes and stops
// before the total would pass --max-total-usdc. report scores Skein and the
// baselines on stored runs, with Wilson score intervals, as Markdown.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { adapterFor, evaluate, type Finding, type StoredPurchase } from "@skein/engine";
import { getPolicy } from "@skein/policies";
import { dexScreenerResolver, loadCatalogue, runVerdict } from "@skein/pipeline";
import { CHECK_INTENTS, networkFromEnv, TelegraphClient, viemSigner } from "@skein/telegraph";
import { casesFileSchema, type Case } from "./cases";
import { answerFor, metrics, SYSTEMS, wilson, type Run } from "./metrics";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    split: { type: "string" },
    // Comma-separated case ids: rerun only these (tune split only: a holdout case is run once).
    ids: { type: "string" },
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
const only = values.ids ? new Set(values.ids.split(",").map((x) => x.trim())) : null;
const cases: Case[] = file.cases.filter((c) => (!values.split || c.split === values.split) && (!only || only.has(c.id)));
if (only && cmd === "run" && cases.some((c) => c.split === "holdout")) throw new Error("--ids reruns tune cases only: a holdout case is run once");

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
} else if (cmd === "rescore") {
  if (!runsDir) throw new Error("rescore needs a runs directory");
  if (values.split !== "tune") throw new Error("rescore re-grades the tune split only: pass --split tune");
  const dir = resolve(cwd, runsDir);
  let changed = 0;
  for (const c of cases) {
    const file = join(dir, `${c.id}.json`);
    if (!existsSync(file)) continue;
    const r = JSON.parse(readFileSync(file, "utf8"));
    if (!r.stored) continue; // imported (prospective) runs carry no raw answers
    const record = getPolicy(r.policyRef);
    const stored = r.stored as { subject: { chainId: number; token: string }; purchases: StoredPurchase[]; unpurchased: Finding[]; receipts: string[] };
    const purchases = stored.purchases.map((p) => ({ ...p, adapterVersion: adapterFor(p.check).version }));
    const findings = [...purchases.map((p) => adapterFor(p.check).adapt(p.rawResult, { ...p, subject: stored.subject })), ...stored.unpurchased];
    const verdict = evaluate(record.policy, stored.subject, findings, stored.receipts, { policySha256: record.sha256 });
    const before = r.verdict.decision.verdict;
    r.verdict = verdict;
    r.stored = { ...r.stored, purchases, findings: verdict.findings, verdictHash: verdict.verdictHash };
    r.rescored = { at: new Date().toISOString(), from: before };
    writeFileSync(file, `${JSON.stringify(r, null, 2)}\n`);
    if (before !== verdict.decision.verdict) {
      changed++;
      console.log(`${c.id}: ${before} -> ${verdict.decision.verdict} (${c.label})`);
    }
  }
  console.log(`rescored; ${changed} verdicts changed`);
} else if (cmd === "import") {
  const key = process.env.SKEIN_API_KEY;
  const api = (process.env.SKEIN_API_URL ?? "https://api.skeinlabs.site").replace(/\/$/, "");
  const out = resolve(cwd, values.out ?? "eval/runs");
  mkdirSync(out, { recursive: true });
  let n = 0;
  for (const c of cases.filter((x) => x.verdictId)) {
    const file = join(out, `${c.id}.json`);
    if (existsSync(file)) continue;
    const get = async (path: string) => {
      // Verdicts are public by id; a key only raises the read rate limit.
      const r = await fetch(`${api}${path}`, key ? { headers: { authorization: `Bearer ${key}` } } : {});
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r.json() as Promise<Record<string, any>>;
    };
    const v = await get(`/v1/verdicts/${c.verdictId}`);
    const bom = await get(`/v1/verdicts/${c.verdictId}/bom`);
    if (String(v.subject?.token).toLowerCase() !== c.token.toLowerCase()) throw new Error(`${c.id}: verdict ${c.verdictId} is for another token`);
    const run = {
      caseId: c.id,
      importedFrom: c.verdictId,
      boughtAt: v.createdAt,
      policyRef: `${v.policy.id}@${v.policy.version}`,
      wallMs: v.durationMs ?? 0,
      verdict: { findings: v.findings, decision: { verdict: v.verdict, coverageBps: Math.round(Number(v.coverage) * 10_000) } },
      purchases: (bom.lines as { check: string; amountUsdc: number; durationMs: number }[]).map((l) => ({ check: l.check, amountUusdc: Math.round(l.amountUsdc * 1e6), durationMs: l.durationMs })),
    };
    writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
    n++;
    console.log(`${c.id}: ${v.verdict} (${c.label}), bought ${v.createdAt}`);
  }
  console.log(`imported ${n} stored verdicts`);
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

function basisNote(basis: Case["basis"]): string {
  return {
  current_state:
    "Current state: each token was checked as it is today, because the miners Skein buys from read only current state. " +
    "A rug drained long ago fails liquidity trivially, so this measures whether Skein would stop a listing today, not whether it would have caught the token before its event.",
  prospective:
    "Prospective: each verdict was bought before the outcome was known, and the label comes from what happened afterwards. " +
    "This is the point-in-time measure.",
  }[basis];
}

function report(kind: string, all: Case[], allRuns: Run[]): string {
  const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
  const ci = (v: [number, number] | null) => (v ? ` (95% CI ${pct(v[0])}–${pct(v[1])})` : "");
  const lines = [
    `# Skein benchmark${values.split ? ` (${values.split})` : ""}`,
    "",
    kind === "example" ? "> EXAMPLE CASES: these exercise the harness. They are not results and must not be reported as such.\n" : "",
    "The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).",
  ];
  for (const basis of ["prospective", "current_state"] as const) {
    const cs = all.filter((c) => c.basis === basis);
    if (cs.length === 0) continue;
    const runs = allRuns.filter((r) => cs.some((c) => c.id === r.caseId));
    const count = (l: Case["label"]) => cs.filter((c) => c.label === l).length;
    lines.push(
      "",
      `## ${basis === "prospective" ? "Prospective" : "Current state"}`,
      "",
      basisNote(basis),
      "",
      `${runs.length} of ${cs.length} cases have a run (good ${count("good")}, bad ${count("bad")}, ambiguous ${count("ambiguous")}). ${runs.length < 30 ? `A sample of ${runs.length} is small; read the intervals, not the point estimates.` : ""}`,
      "",
      ...(count("good") === 0
        ? ["**No case in this set is labelled good**, so a low false-APPROVE rate cannot be told apart from never approving: read it next to the APPROVE column.", ""]
        : []),
      "| System | APPROVE (all) | APPROVE on good | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | Coverage |",
      "|---|---|---|---|---|---|---|---|---|---|",
    );
    for (const sys of SYSTEMS) {
      const answers = runs.map((r) => answerFor(sys, r));
      const m = metrics(cs, answers);
      lines.push(
        `| ${sys} | ${pct(m.approveRate)} | ${pct(m.goodApproveRate)} | ${pct(m.falseApproveRate)}${ci(wilson(m.badApproved, m.bad))} | ${pct(m.rejectPrecision)} | ${pct(m.rejectRecall)}${ci(wilson(m.badRejected, m.bad))} | ${pct(m.escalateRate)} | ${pct(m.abstainRate)} | $${m.costPerVerdictUsdc.toFixed(3)} | ${pct(m.meanCoverage)} |`,
      );
    }
    const skein = metrics(cs, runs.map((r) => answerFor("skein", r)));
    lines.push("", `Latency (Skein's wall time; the baselines reuse the same runs): p50 ${skein.p50LatencyMs} ms, p95 ${skein.p95LatencyMs} ms.`);
  }
  lines.push(
    "",
    "Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.",
    "Intervals are 95% Wilson score intervals on the counts behind each rate.",
  );
  return lines.join("\n");
}
