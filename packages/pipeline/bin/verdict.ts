// pnpm verdict --chain 8453 --token 0x... [--policy dex-list] [--live] [--scenario clean|conflict|timeout]
//
// Without --live the run is SIMULATED: a local fake node answers with canned
// data. Its output is for development only and is never evidence.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseSubject } from "@skein/engine";
import { getPolicy } from "@skein/policies";
import { CHECK_INTENTS, networkFromEnv, TelegraphClient, TESTNET, viemSigner } from "@skein/telegraph";
import { FakeNode, type Behaviour } from "@skein/telegraph/testing";
import { catalogueFromSnapshot, dexScreenerResolver, loadCatalogue, runVerdict, type PipelineEvent } from "../src";

const { values } = parseArgs({
  options: {
    chain: { type: "string" },
    token: { type: "string" },
    policy: { type: "string", default: "dex-list" },
    budget: { type: "string" },
    social: { type: "string" },
    repo: { type: "string" },
    deployer: { type: "string" },
    pool: { type: "string" },
    live: { type: "boolean", default: false },
    "pre-season-test": { type: "boolean", default: false },
    scenario: { type: "string", default: "clean" },
    out: { type: "string", default: "out/verdicts" },
  },
});

const subject = parseSubject({ chainId: Number(values.chain), token: values.token });
const { policy } = getPolicy(values.policy!);
const intents = Object.values(CHECK_INTENTS).filter((i): i is string => !!i);
const snapshot = JSON.parse(readFileSync(new URL("../../telegraph/snapshots/2026-10-30.json", import.meta.url), "utf8"));

async function deps() {
  if (values.live) {
    const network = networkFromEnv();
    const key = process.env.PURCHASER_PRIVATE_KEY as `0x${string}` | undefined;
    if (!key) throw new Error("--live needs PURCHASER_PRIVATE_KEY (burner hot wallet)");
    const client = new TelegraphClient({
      network,
      signer: viemSigner(key),
      maxUusdcPerCall: 50_000,
      allowPreSeason: values["pre-season-test"],
    });
    return { client, catalogue: await loadCatalogue(client, intents), resolver: dexScreenerResolver(), mode: `LIVE ${network.caip2}` };
  }
  const now = Date.parse("2026-11-03T10:00:00Z");
  const canned: Record<string, unknown> = {
    "200001": { result: { [subject.token]: { is_honeypot: "0", is_open_source: "1", buy_tax: "0", sell_tax: "0" } } },
    "78021": { matched: "clear" },
    "72006": { liquidity_usd: 4_500_000 },
    "7302": { holders_count: 120_000 },
    "7378": values.scenario === "conflict" ? { verdict: "wash_trading", wash_volume_pct: 72 } : { verdict: "organic", wash_volume_pct: 3 },
    "7457": { verdict: "human" },
  };
  const node = new FakeNode({
    nowSec: () => Math.floor(now / 1000),
    respond: (id): Behaviour =>
      values.scenario === "timeout" && id === "78021" ? { kind: "hang" } : { kind: "answer", result: canned[id] ?? {} },
  });
  const client = new TelegraphClient({ network: TESTNET, signer: viemSigner(`0x${"11".repeat(32)}`), fetch: node.fetch, maxUusdcPerCall: 50_000, now: () => now });
  return {
    client,
    catalogue: catalogueFromSnapshot(snapshot),
    resolver: { resolve: async () => "0xd0b53d9277642d899df5c87a3966a349a798f224" },
    mode: `SIMULATED (${values.scenario}); not evidence`,
  };
}

const d = await deps();
console.error(`skein verdict · ${d.mode} · ${policy.id}@${policy.version} · ${subject.chainId}:${subject.token}`);
const log = (e: PipelineEvent) => {
  if (e.type === "purchase") {
    const p = e.purchase;
    console.error(`  ${p.check.padEnd(16)} miner ${String(p.minerId ?? "routed").padEnd(7)} ${p.error ? `ERROR ${p.error}` : `${p.amountUusdc} uUSDC  receipt ${p.receiptHash?.slice(0, 12)}…`}`);
  }
};
const run = await runVerdict(
  {
    policy,
    subject,
    context: {
      ...(values.social ? { socialHandle: values.social } : values.live ? {} : { socialHandle: "project" }),
      ...(values.repo ? { repoUrl: values.repo } : {}),
      ...(values.deployer ? { deployer: values.deployer } : {}),
      ...(values.pool ? { pool: values.pool } : {}),
    },
    ...(values.budget ? { budgetUusdc: Math.round(Number(values.budget) * 1e6) } : {}),
  },
  { client: d.client, catalogue: d.catalogue, resolver: d.resolver, priceUusdc: 250_000, onEvent: log },
);

if (!run.ok) {
  console.error(`refused before any purchase: ${run.plan.refusal.code} (${run.plan.refusal.detail})`);
  console.log(JSON.stringify(run.plan, null, 2));
  process.exit(2);
}
const v = run.verdict;
const record = { mode: d.mode, verdict: v, purchases: run.purchases, stored: run.stored };
const dir = resolve(process.env.INIT_CWD ?? process.cwd(), values.out!);
mkdirSync(dir, { recursive: true });
const file = `${dir}/${v.verdictHash.slice(2, 14)}.json`;
writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
console.error(`${v.decision.verdict} · risk ${v.decision.riskBps} bps · confidence ${v.decision.confidenceBps} bps · coverage ${v.decision.coverageBps} bps`);
console.error(v.summary);
console.error(`verdict ${v.verdictHash}\nbom     ${v.bom.root} (${v.bom.items} receipts)\nsaved   ${file}  ->  pnpm repro ${file}`);
