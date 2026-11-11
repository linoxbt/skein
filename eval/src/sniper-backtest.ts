// Replays every answered Skein Sniper verdict under one or more policies, with
// the current engine, and reports how the tokens each decision class picked
// went on to trade. Offline: the findings are the ones Skein paid for.
//
//   pnpm --filter @skein/eval exec tsx src/sniper-backtest.ts [policy refs…]
//   (default: agent-pretrade@0.2.0 agent-pretrade@0.3.0)
import { readFileSync } from "node:fs";
import { decide, type Finding } from "@skein/engine";
import { getPolicy } from "@skein/policies";

interface Case {
  verdictId: string;
  symbol: string;
  change: number;
  findings: Finding[];
}

const data = JSON.parse(readFileSync(new URL("../sniper/backtest-2026-11-11.json", import.meta.url), "utf8")) as { cases: Case[] };
const refs = process.argv.slice(2).length ? process.argv.slice(2) : ["agent-pretrade@0.2.0", "agent-pretrade@0.3.0"];
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
};
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function backtest(ref: string, cases: readonly Case[] = data.cases) {
  const { policy } = getPolicy(ref);
  const by: Record<string, number[]> = {};
  for (const c of cases) (by[decide(policy, c.findings).decision.verdict] ??= []).push(c.change);
  return Object.fromEntries(
    Object.entries(by).map(([verdict, xs]) => [verdict, { n: xs.length, medianChange: median(xs), wentToZero: xs.filter((x) => x <= -0.9).length, fellHalf: xs.filter((x) => x <= -0.5).length, rose: xs.filter((x) => x > 0).length }]),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`${data.cases.length} answered sniper verdicts`);
  for (const ref of refs) {
    console.log(ref);
    for (const [v, r] of Object.entries(backtest(ref))) {
      console.log(`  ${v.padEnd(9)} n=${String(r.n).padStart(3)}  median ${pct(r.medianChange).padStart(7)}  to zero ${r.wentToZero}  fell half ${r.fellHalf}  rose ${r.rose}`);
    }
  }
}
