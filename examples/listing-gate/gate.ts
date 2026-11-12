// A listing gate: check each token with Skein before it goes live.
//
//   SKEIN_API_KEY=sk_part_… npx tsx gate.ts base:0x4200000000000000000000000000000000000006 ethereum:0x…
//   … gate.ts --allow review,retry base:0x…    also pass on those decisions
//
// Each token gets one of four decisions, straight from its verdict:
//   APPROVE  → list      REJECT  → block
//   ESCALATE → review    ABSTAIN → retry   (not enough evidence; ABSTAIN costs only upstream)
//
// Pays with a partner key (SKEIN_API_KEY) or, with SKEIN_PAYER_KEY set, per
// verdict through Telegraph escrow. Spend is capped per verdict and per run,
// and every verdict is re-verified. Decisions go to stdout and decisions.json.
// Exit codes, so CI fails closed: 0 only when every token gets "list" (or a
// decision named in --allow); 1 when any token is blocked; 2 when any token
// got anything else (review, retry, refused, error: Skein being down is not a pass).
import { writeFileSync } from "node:fs";
import { Skein, SkeinError, SpendCapError, type Payer, type VerdictResult } from "@skeinlabs/sdk";

const CHAINS: Record<string, number> = { ethereum: 1, eth: 1, base: 8453, bsc: 56, bnb: 56, arbitrum: 42161 };
const DECISION = { APPROVE: "list", REJECT: "block", ESCALATE: "review", ABSTAIN: "retry" } as const;
type Decision = (typeof DECISION)[keyof typeof DECISION] | "refused" | "error";

const env = process.env;
const apiUrl = env.SKEIN_API_URL ?? "https://api.skeinlabs.site";
const policy = env.SKEIN_POLICY || "dex-list@0.2.0";

/** A USDC amount: a finite number above 0. A typo must not turn a cap off (NaN compares false). */
function usdc(name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) {
    console.error(`${name} must be a positive number of USDC (got ${JSON.stringify(raw)})`);
    process.exit(64);
  }
  return v;
}
const maxUsdcPerCall = usdc("SKEIN_MAX_USDC_PER_CALL", 0.3);
const runCapUsdc = usdc("SKEIN_RUN_CAP_USDC", 2);

async function payer(): Promise<Payer> {
  if (env.SKEIN_PAYER_KEY) {
    // Loaded only on this path: the Telegraph rail needs viem.
    const { TelegraphClient, networkFromEnv, viemSigner } = await import("@skeinlabs/sdk/telegraph");
    const client = new TelegraphClient({
      network: networkFromEnv(env),
      signer: viemSigner(env.SKEIN_PAYER_KEY as `0x${string}`),
      maxUusdcPerCall: Math.round(maxUsdcPerCall * 1e6),
    });
    // Skein's miner (845301) on FRAUD_RISK_GENERAL unless overridden; answers about another token, or from another miner, are refused.
    return { kind: "telegraph", client, ...(env.SKEIN_INTENT ? { intent: env.SKEIN_INTENT } : {}), ...(env.SKEIN_MINER_ID ? { minerId: env.SKEIN_MINER_ID } : {}) };
  }
  if (env.SKEIN_API_KEY) return { kind: "apiKey", key: env.SKEIN_API_KEY };
  throw new Error("set SKEIN_API_KEY (a partner key) or SKEIN_PAYER_KEY (a funded Telegraph burner)");
}

function parse(arg: string) {
  const [chain, token] = arg.includes(":") ? arg.split(":") : ["base", arg];
  const chainId = CHAINS[chain!.toLowerCase()] ?? Number(chain);
  if (!Number.isInteger(chainId) || !/^0x[0-9a-fA-F]{40}$/.test(token ?? "")) throw new Error(`not chain:0xtoken: ${arg}`);
  return { chainId, token: token! };
}

/** What this verdict cost us: a paid ask costs what it cost; a partner-key cache hit or replay costs nothing. */
const costOf = (v: VerdictResult) => (v.payment.rail !== "apiKey" ? v.payment.amountUsdc : v.cached || v.replayed ? 0 : v.cost.priceUsdc);

const USAGE = "usage: npx tsx gate.ts [--allow review,retry] <chain:0xtoken>…   e.g. base:0x4200000000000000000000000000000000000006";
let subjects: { chainId: number; token: string }[];
const allowed = new Set<Decision>(["list"]);
try {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--allow");
  if (at >= 0) {
    for (const d of (argv[at + 1] ?? "").split(",").filter(Boolean)) {
      if (!["review", "retry", "refused", "error"].includes(d)) throw new Error(`--allow takes review, retry, refused or error (not ${d}); block never passes`);
      allowed.add(d as Decision);
    }
    argv.splice(at, 2);
  }
  subjects = argv.map(parse);
} catch (e) {
  console.error(`${(e as Error).message}\n${USAGE}`);
  process.exit(64);
}
if (!subjects.length) {
  console.error(USAGE);
  process.exit(64);
}

const skein = new Skein({ apiUrl, payer: await payer(), maxUsdcPerCall });
const day = new Date().toISOString().slice(0, 10);
let spent = 0;
const rows: { chainId: number; token: string; decision: Decision; verdict?: string; riskBps?: number; why: string; costUsdc: number; verified?: boolean; link?: string }[] = [];

for (const subject of subjects) {
  const row = { ...subject, decision: "error" as Decision, why: "", costUsdc: 0 };
  try {
    // Free: what it would cost, or why it would be refused, before any money moves.
    const quote = await skein.quote({ subject, policy });
    if (!quote.ok) {
      rows.push({ ...row, decision: "refused", why: `${quote.refusal?.code}: ${quote.refusal?.detail}` });
      continue;
    }
    if (spent + quote.priceUsdc > runCapUsdc) {
      rows.push({ ...row, decision: "refused", why: `run cap: ${spent.toFixed(2)} + ${quote.priceUsdc} USDC is above ${runCapUsdc}` });
      continue;
    }

    const v = await skein.verdict({
      subject,
      policy,
      quote, // reuse it: verdict() checks maxUsdcPerCall against it without asking again
      // One key per token per day: re-running the gate today returns the same verdict, uncharged.
      idempotencyKey: `listing-gate:${subject.chainId}:${subject.token.toLowerCase()}:${day}`,
    });
    spent += costOf(v);

    // Don't take the verdict on trust: recompute it from the raw answers Skein paid for.
    const report = await skein.verify(v.id);
    rows.push({
      ...row,
      decision: report.ok ? DECISION[v.verdict] : "review",
      verdict: v.verdict,
      riskBps: v.riskBps,
      why: report.ok ? v.summary : `verification failed: ${report.problems.join("; ")}`,
      costUsdc: costOf(v),
      verified: report.ok,
      link: `https://skeinlabs.site/v/${v.id}`,
    });
  } catch (e) {
    if (e instanceof SpendCapError) rows.push({ ...row, decision: "refused", why: e.message });
    else if (e instanceof SkeinError) {
      spent += e.payment?.amountUsdc ?? 0; // a paid ask that produced no verdict still counts
      rows.push({ ...row, decision: "error", why: `${e.code}: ${e.message}`, costUsdc: e.payment?.amountUsdc ?? 0 });
    } else throw e;
  }
}

for (const r of rows) {
  console.log(`${r.decision.toUpperCase().padEnd(8)} ${String(r.chainId).padEnd(6)} ${r.token}  ${r.verdict ?? "-"}${r.riskBps !== undefined ? ` ${r.riskBps} bps` : ""}`);
  console.log(`         ${r.why}${r.link ? `\n         ${r.link}` : ""}`);
}
console.log(`\n${rows.length} tokens · spent ${spent.toFixed(2)} USDC (cap ${runCapUsdc})`);
writeFileSync("decisions.json", JSON.stringify({ at: new Date().toISOString(), policy, spentUsdc: spent, rows }, null, 2));
// Fail closed: only "list" (and what --allow names) passes.
process.exit(rows.some((r) => r.decision === "block") ? 1 : rows.every((r) => allowed.has(r.decision)) ? 0 : 2);
