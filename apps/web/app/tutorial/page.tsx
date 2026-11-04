import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { IconArrow, PageHero, REPO_URL, Stripes } from "@skein/ui";
import { Code } from "@/components/Code";
import { API } from "@/lib/api";

export const metadata: Metadata = {
  title: "Tutorial",
  description:
    "Build a token listing gate with Skein: quote, buy and verify listing verdicts from TypeScript, pay per call through Telegraph, and give Claude or Cursor the same tools over MCP.",
};

const REPO = "https://github.com/linoxbt/skein";
/** The source tree the site is built from, and its branch (REPO_URL names it). */
const TREE = REPO_URL;
const BRANCH = REPO_URL.includes("/tree/") && !REPO_URL.endsWith("/tree/main") ? REPO_URL.split("/tree/")[1]! : "";
const EXAMPLE = `${TREE}/examples/listing-gate`;
const KEY_REQUEST = `${REPO}/issues/new?template=partner-key.yml`;
const WETH_BASE = "0x4200000000000000000000000000000000000006";

const TOC: [string, string][] = [
  ["overview", "What you'll build"],
  ["concepts", "How a verdict works"],
  ["first-call", "Your first call"],
  ["install", "Install the SDK"],
  ["verdict", "Buy a verdict"],
  ["stream", "Watch it being made"],
  ["verify", "Verify it"],
  ["production", "Production patterns"],
  ["telegraph", "Pay per call"],
  ["mcp", "Give it to an agent"],
  ["listing-gate", "Build the listing gate"],
  ["troubleshooting", "Troubleshooting"],
  ["next", "Where next"],
];

// ── Snippets ────────────────────────────────────────────────────────────────

const quoteCurl = (api: string) => `curl "${api}/v1/quote?chain=8453&token=${WETH_BASE}"`;

const quoteResponse = `{
  "subject": { "chainId": 8453, "token": "${WETH_BASE}" },
  "policy": "dex-list@0.1.0",
  "priceUsdc": 0.25,
  "pricing": "standard; ABSTAIN is charged at upstream cost only",
  "ok": true,
  "upstreamUsdc": 0.06,
  "checks": [
    { "check": "contract_audit",  "intent": "SMART_CONTRACT_AUDIT_GENERAL",      "quoteUsdc": 0.01 },
    { "check": "holder_count",    "intent": "TOKEN_HOLDER_COUNT_GENERAL",        "quoteUsdc": 0.01 },
    { "check": "liquidity_depth", "intent": "LIQUIDITY_DEPTH_VERIFY_GENERAL",    "quoteUsdc": 0.01 },
    { "check": "sanctions",       "intent": "SANCTIONS_SCREENING_MATCH_GENERAL", "quoteUsdc": 0.01 },
    { "check": "social_bots",     "intent": "SOCIAL_BOT_DETECTION_GENERAL",      "quoteUsdc": 0.01 },
    { "check": "wash_trading",    "intent": "WASH_TRADING_DETECTION_GENERAL",    "quoteUsdc": 0.01 }
  ]
}`;

const verdictCurl = (api: string) => `curl -X POST ${api}/v1/verdicts \\
  -H "Authorization: Bearer $SKEIN_API_KEY" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{
    "subject": { "chainId": 8453, "token": "${WETH_BASE}" },
    "policy": "dex-list@0.1.0",
    "mode": "async"
  }'
# → 202 { "id": "vrd_…", "status": "running" }

curl ${api}/v1/verdicts/vrd_…          # the verdict, once sealed
curl -X POST ${api}/v1/verify \\
  -H "Content-Type: application/json" -d '{ "id": "vrd_…" }'`;

const install = `mkdir listing-gate && cd listing-gate
npm init -y && npm pkg set type=module
npm install @skeinlabs/sdk
npm install -D tsx typescript @types/node`;

const firstQuote = (api: string) => `// quote.ts: run with  npx tsx quote.ts
import { Skein } from "@skeinlabs/sdk";

const skein = new Skein({ apiUrl: "${api}" });

const q = await skein.quote({
  subject: { chainId: 8453, token: "${WETH_BASE}" }, // WETH on Base
  policy: "dex-list@0.1.0",
});

if (q.ok) console.log(\`\${q.priceUsdc} USDC buys \${q.checks?.length} checks\`);
else console.log("would be refused:", q.refusal?.code, q.refusal?.detail);`;

const firstVerdict = (api: string) => `// verdict.ts: SKEIN_API_KEY=sk_part_… npx tsx verdict.ts
import { Skein, SkeinError, SpendCapError } from "@skeinlabs/sdk";

const skein = new Skein({
  apiUrl: "${api}",
  payer: { kind: "apiKey", key: process.env.SKEIN_API_KEY! },
  maxUsdcPerCall: 0.3, // quoted first; refused before paying above this
});

try {
  const v = await skein.verdict({
    subject: { chainId: 8453, token: "${WETH_BASE}" },
    policy: "dex-list@0.1.0",
  });

  console.log(v.verdict, v.riskBps, "bps");
  console.log(v.summary);
  for (const r of v.reasons) console.log("-", r.detail);
  console.log("open risks:", v.openRisks);
  console.log("cost:", v.cost.priceUsdc, "USDC, upstream", v.cost.upstreamUsdc);
  console.log("page:", "https://skeinlabs.site/v/" + v.id);
} catch (e) {
  if (e instanceof SpendCapError) console.log("too expensive:", e.priceUsdc, "USDC");
  else if (e instanceof SkeinError) console.log(e.code, e.message);
  else throw e;
}`;

const verdictShape = `interface VerdictObject {
  id: string;                      // "vrd_…", public: anyone can GET, verify and audit it
  verdict: "APPROVE" | "REJECT" | "ESCALATE" | "ABSTAIN";
  riskBps: number;                 // 0–10000: how risky, in basis points
  confidenceBps: number;           // 0–10000: how sure, given the evidence that arrived
  coverage: number;                // 0–1: share of the policy's checks that answered
  summary: string;                 // one line a human can read
  reasons: { code: string; check?: string; detail: string }[];
  openRisks: string[];             // what was not settled (a check that failed, a conflict)
  conflicts: string[];             // where two sources disagreed
  findings: Finding[];             // one per check: status, severity, value, source, receipt
  cost: { upstreamUsdc: number; priceUsdc: number; currency: "USDC" };
  bom: { root: string; items: number };   // Merkle root over every paid input's receipt
  policy: { id: string; version: string };
  engineVersion: string;
  verdictHash: string;             // hash over the whole decision: recompute it with verify()
  network: string;                 // "testnet" today; "simulated" means canned answers
  cached?: boolean;                // served from cache: no new purchases
  replayed?: boolean;              // same Idempotency-Key as before: not charged again
  payment: { rail: "apiKey" } | { rail: "telegraph"; minerId; amountUsdc; receiptHash; signalHash };
}`;

const realAbstain = `{
  "id": "vrd_mw1xqc4d3k4t22320e31",
  "verdict": "ABSTAIN",
  "summary": "Abstained: required check contract_audit is ERROR (+3 more).",
  "reasons": [
    { "code": "MISSING_REQUIRED_CHECK", "check": "contract_audit", "detail": "required check contract_audit is ERROR" },
    …
  ],
  "cost": { "upstreamUsdc": 0, "priceUsdc": 0, "pricingRule": "abstain_upstream_only", "currency": "USDC" },
  "bom": { "root": "0x0000…0000", "items": 0 },
  "verdictHash": "0x8f1ac48e5260f1c43b36942a1df39af128c5f747f7ac85564c253095437ec923",
  "network": "testnet",
  "durationMs": 2379
}`;

const onEvent = `const v = await skein.verdict({
  subject,
  onEvent: (e) => {
    switch (e.type) {
      case "plan":     console.log("buying", e.data.purchases?.map((p) => p.check)); break;
      case "purchase": console.log("paid", e.data.check, e.data.amountUusdc / 1e6, "USDC", e.data.receiptHash); break;
      case "finding":  console.log(e.data.check, e.data.status, e.data.notes.join("; ")); break;
      case "decision": console.log("decided", e.data.decision.verdict); break;
    }
  },
});`;

const submitWait = `// Start now, collect later: useful in a queue worker or a serverless function.
const started = await skein.submit({ subject, idempotencyKey: jobId });
if ("status" in started && started.status === "running") {
  await queue.later({ verdictId: started.id });       // returns in milliseconds
}

// …in another invocation:
const v = await skein.wait(verdictId, { timeoutMs: 60_000 });

// Or follow any verdict's events yourself, replayed from the start:
for await (const e of skein.stream(verdictId)) console.log(e.type);`;

const verifyCode = `const report = await skein.verify(v.id);
// {
//   ok: true,
//   checks: {
//     adaptersRerun: true,     // each raw paid answer re-parsed into the same finding
//     policyRerun: true,       // the policy file re-applied to those findings
//     policyFile: true,        // the policy text matches its published sha256
//     engineVersion: true,     // the engine that sealed it is the one that re-ran it
//     decisionMatches: true,   // same verdict, risk and confidence
//     bomRootRebuilt: true,    // the receipts' Merkle root rebuilt from the lines
//     receiptsMatch: true      // every line's receipt is the one Telegraph returned
//   },
//   verdictHash: { stored: "0x…", recomputed: "0x…" },
//   problems: []
// }
if (!report.ok) throw new Error("verdict did not verify: " + report.problems.join("; "));

const bom = await skein.bom(v.id);           // the bill of materials
for (const line of bom.lines) {
  console.log(line.check, line.minerName, line.amountUsdc, "USDC", line.receiptHash);
}`;

const errorsCode = `import { SkeinError, SpendCapError } from "@skeinlabs/sdk";

try {
  return await skein.verdict({ subject, idempotencyKey });
} catch (e) {
  if (e instanceof SpendCapError) return hold("price above cap", e.priceUsdc);   // nothing paid
  if (!(e instanceof SkeinError)) throw e;
  if (e.payment) ledger.add(e.payment.amountUsdc);  // paid, but no verdict: count it
  switch (e.code) {
    case "BUDGET_TOO_LOW":                          // live floors above your budget
    case "UPSTREAM_UNAVAILABLE":                    // a required check has no live miner
    case "DAILY_CAP_REACHED":                       // Skein's own cap for the day
      return retryLater(e.code);
    case "RATE_LIMITED":                            // the SDK already waited and retried
    case "TIMEOUT":
      return retryLater(e.code, { sameKey: idempotencyKey });
    default:
      throw e;                                      // INVALID_SUBJECT, UNAUTHORIZED, …
  }
}`;

const options = (api: string) => `const skein = new Skein({
  apiUrl: "${api}",
  payer: { kind: "apiKey", key },
  maxUsdcPerCall: 0.3,      // checked against a fresh quote before any payment
  retries: 2,               // network errors, 429 and retryable 5xx (POSTs only with an idempotency key)
  maxRetryWaitMs: 10_000,   // never sleep longer than this in total; a longer Retry-After throws
  requestTimeoutMs: 15_000, // per HTTP request
  timeoutMs: 120_000,       // how long verdict() waits for the seal
});`;

const burner = `# 1. A fresh burner wallet (Foundry's cast; or any wallet you only use for this)
cast wallet new

export KEY=0x…            # the burner's private key: never a wallet that holds real funds
export ME=0x…             # its address
export RPC=https://ethereum-sepolia-rpc.publicnode.com
export USDC=0xcc194e1a843B658526D0D5C431f670028582Ae17     # Telegraph test USDC
export DIAMOND=0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b  # Telegraph escrow

# 2. Sepolia ETH for gas: any public Sepolia faucet, sent to $ME

# 3. Mint 10 test USDC (6 decimals): anyone can mint the test token
cast send $USDC "mint(address,uint256)" $ME 10000000 --rpc-url $RPC --private-key $KEY

# 4. Deposit 5 USDC into escrow: paid asks settle from here
cast send $USDC "approve(address,uint256)" $DIAMOND 5000000 --rpc-url $RPC --private-key $KEY
cast send $DIAMOND "depositUSDC(uint256)" 5000000 --rpc-url $RPC --private-key $KEY

# 5. Check the escrow balance (micro-USDC)
cast call $DIAMOND "effectiveBalance(address)(int256)" $ME --rpc-url $RPC`;

const telegraphCode = (api: string) => `npm install viem   # the Telegraph entry signs with it

// telegraph.ts: SKEIN_PAYER_KEY=0x… npx tsx telegraph.ts
import { Skein } from "@skeinlabs/sdk";
import { TelegraphClient, TESTNET, viemSigner } from "@skeinlabs/sdk/telegraph";

const client = new TelegraphClient({
  network: TESTNET,                                   // Sepolia escrow, Telegraph dev node
  signer: viemSigner(process.env.SKEIN_PAYER_KEY as \`0x\${string}\`),
  maxUusdcPerCall: 300_000,                           // 0.30 USDC: no challenge is signed above this
});

const skein = new Skein({
  apiUrl: "${api}",                     // only for reading the sealed verdict back
  payer: {
    kind: "telegraph",
    client,
    minerId: process.env.SKEIN_MINER_ID,             // pin Skein's miner (see /status)
  },
});

const v = await skein.verdict({ subject: { chainId: 1, token: "0x…" } });
console.log(v.verdict, v.payment);
// { rail: "telegraph", minerId: "…", amountUsdc: …, receiptHash: "0x…", signalHash: "0x…" }`;

const claudeCode = `claude mcp add skein --env SKEIN_API_KEY=sk_part_… -- npx -y @skeinlabs/mcp`;

const desktop = `{
  "mcpServers": {
    "skein": {
      "command": "npx",
      "args": ["-y", "@skeinlabs/mcp"],
      "env": {
        "SKEIN_API_KEY": "sk_part_…",
        "SKEIN_MAX_USDC_PER_CALL": "0.30",
        "SKEIN_SESSION_CAP_USDC": "2"
      }
    }
  }
}`;

const prompt = `You: Before we add 0x4200000000000000000000000000000000000006 on Base to the
     launchpad, check it with Skein. Tell me the cost first.

Agent → skein_quote   { chainId: "base", token: "0x4200…0006" }
      ← dex-list@0.1.0: 0.25 USDC per verdict; buys 6 checks upstream for about 0.06 USDC
Agent → skein_verdict { chainId: "base", token: "0x4200…0006" }
      ← <VERDICT> · risk <n> bps · confidence <n>% · coverage <n>%
        <summary, reasons, open risks, cost>
        Verdict hash 0x…. Verify: https://skeinlabs.site/v/vrd_…
Agent → skein_verify  { id: "vrd_…" }
      ← VERIFIED: vrd_…  ✓ adaptersRerun ✓ policyRerun ✓ decisionMatches …`;

const gateCore = `const DECISION = { APPROVE: "list", REJECT: "block", ESCALATE: "review", ABSTAIN: "retry" } as const;

for (const subject of subjects) {
  // 1. Free: what it would cost, or why it would be refused, before any money moves.
  const quote = await skein.quote({ subject, policy });
  if (!quote.ok) { refuse(subject, quote.refusal); continue; }
  if (spent + quote.priceUsdc > runCapUsdc) { refuse(subject, "run cap"); continue; }

  // 2. Buy it. One idempotency key per token per day: re-running today is free.
  const v = await skein.verdict({
    subject, policy, quote,
    idempotencyKey: \`listing-gate:\${subject.chainId}:\${subject.token.toLowerCase()}:\${day}\`,
  });
  spent += v.cached || v.replayed ? 0 : v.cost.priceUsdc;

  // 3. Don't take it on trust: recompute it.
  const report = await skein.verify(v.id);

  // 4. Act. A verdict that fails verification goes to a human, never to "list".
  decide(subject, report.ok ? DECISION[v.verdict] : "review", v);
}

process.exit(rows.some((r) => r.decision === "block") ? 1 : 0);   // CI fails on a block`;

const gateRun = `git clone${BRANCH ? ` -b ${BRANCH}` : ""} ${REPO}.git && cd skein/examples/listing-gate
npm install
SKEIN_API_KEY=sk_part_… npm run gate -- \\
  base:0x4200000000000000000000000000000000000006 \\
  ethereum:0xdAC17F958D2ee523a2206206994597C13D831ec7

# one block per token: decision, chain, token, verdict and risk, then why and the verdict page
<DECISION> 8453   0x4200…0006  <VERDICT> <risk> bps
           <summary>
           https://skeinlabs.site/v/vrd_…
<DECISION> 1      0xdAC1…1ec7  <VERDICT> <risk> bps
           <summary>
           https://skeinlabs.site/v/vrd_…

2 tokens · spent <total> USDC (cap 2)`;

const ciYaml = `# .github/workflows/listing-gate.yml: check every token added to tokens.txt
on:
  pull_request:
    paths: ["tokens.txt"]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npx tsx gate.ts $(cat tokens.txt)
        env:
          SKEIN_API_KEY: \${{ secrets.SKEIN_API_KEY }}
          SKEIN_RUN_CAP_USDC: "5"
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: decisions, path: decisions.json }`;

// ── Building blocks ─────────────────────────────────────────────────────────

function H2({ id, n, children }: { id: string; n: string; children: ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-28 pt-20 first:pt-0">
      <span className="block font-mono text-[13px] tracking-wider text-thread-deep">{n}</span>
      <span className="display mt-3 block text-[36px] md:text-[52px]">{children}</span>
    </h2>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-10 text-[22px] font-medium text-ink">{children}</h3>;
}

function P({ children }: { children: ReactNode }) {
  return <p className="mt-5 text-[17px] leading-[1.75] text-ink-2">{children}</p>;
}

function C({ children }: { children: ReactNode }) {
  return <code className="break-words bg-mist px-1.5 py-0.5 font-mono text-[0.88em] text-ink">{children}</code>;
}

function Block({ label, children }: { label: string; children: string }) {
  return (
    <div className="mt-6">
      <Code label={label}>{children}</Code>
    </div>
  );
}

function Note({ title, tone = "thread", children }: { title: string; tone?: "thread" | "knot" | "reject"; children: ReactNode }) {
  const bar = tone === "knot" ? "border-knot-deep" : tone === "reject" ? "border-reject-deep" : "border-thread-deep";
  return (
    <aside className={`mt-8 border-l-4 ${bar} bg-mist p-5 md:p-6`}>
      <p className="font-mono text-[12px] uppercase tracking-wider text-ink">{title}</p>
      <div className="mt-2 text-[16px] leading-[1.7] text-ink-2">{children}</div>
    </aside>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="mt-6 overflow-x-auto border border-rule" tabIndex={0}>
      <table className="w-full min-w-[560px] border-collapse text-left text-[15px]">
        <thead className="bg-mist">
          <tr>{head.map((h) => <th key={h} scope="col" className="px-4 py-3 font-mono text-[12px] font-normal uppercase tracking-wider text-ink">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-rule align-top">
              {r.map((cell, j) => <td key={j} className={`px-4 py-3 ${j === 0 ? "text-ink" : "text-ink-2"}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Steps({ items }: { items: [string, ReactNode][] }) {
  return (
    <ol className="mt-6 space-y-4">
      {items.map(([t, body], i) => (
        <li key={t} className="grid grid-cols-[40px_1fr] gap-4">
          <span className="grid h-9 w-9 place-items-center border border-rule font-mono text-[13px] text-ink">{String(i + 1).padStart(2, "0")}</span>
          <div className="pt-1.5">
            <p className="text-[17px] text-ink">{t}</p>
            <div className="mt-1 text-[16px] leading-[1.7] text-ink-2">{body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

const A = ({ href, children }: { href: string; children: ReactNode }) =>
  href.startsWith("/") ? (
    <Link href={href} className="text-thread-deep underline underline-offset-4 hover:text-ink">{children}</Link>
  ) : (
    <a href={href} className="text-thread-deep underline underline-offset-4 hover:text-ink">{children}</a>
  );

// ── Page ────────────────────────────────────────────────────────────────────

export default function TutorialPage() {
  return (
    <>
      <PageHero
        compact
        tag="Tutorial · about 30 minutes"
        title={<>Build a listing gate<br />with Skein.</>}
        sub="From a free quote to a verified, paid verdict, then the same thing for an AI agent over MCP. By the end you will have a gate that decides list, block, review or retry for any EVM token, and can prove why."
        background={<Stripes seed={11} className="opacity-35" />}
        actions={
          <>
            <a href="#first-call" className="btn btn-primary">Start</a>
            <a href={EXAMPLE} className="btn btn-light">The finished example</a>
          </>
        }
      />

      <section className="bg-paper text-ink">
        <div className="mx-auto grid max-w-[1400px] gap-12 px-5 py-16 md:px-10 md:py-24 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-20">
          <nav aria-label="On this page" className="lg:sticky lg:top-28 lg:self-start">
            <details className="border border-rule lg:hidden">
              <summary className="cursor-pointer px-4 py-3 font-mono text-[13px] uppercase tracking-wider">On this page</summary>
              <ol className="border-t border-rule px-4 py-3">
                {TOC.map(([id, t], i) => (
                  <li key={id}><a href={`#${id}`} className="block py-1.5 text-[15px] text-ink-2 hover:text-thread-deep">{String(i + 1).padStart(2, "0")} {t}</a></li>
                ))}
              </ol>
            </details>
            <div className="hidden lg:block">
              <p className="font-mono text-[12px] uppercase tracking-wider text-ink-2">On this page</p>
              <ol className="mt-4 border-l border-rule">
                {TOC.map(([id, t], i) => (
                  <li key={id}>
                    <a href={`#${id}`} className="-ml-px block border-l border-transparent py-1.5 pl-4 text-[14px] text-ink-2 hover:border-thread-deep hover:text-ink">
                      <span className="font-mono text-[12px]">{String(i + 1).padStart(2, "0")}</span> {t}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          </nav>

          <article className="min-w-0 max-w-[820px]">
            {/* 01 */}
            <H2 id="overview" n="01 · Overview">What you&apos;ll build</H2>
            <P>
              Every exchange, launchpad and wallet that lists tokens faces the same question: is this one safe to put in front of users?
              Answering it well means buying a contract audit, a holder scan, a liquidity check, sanctions screening, wash-trading and
              bot detection, then deciding what to do when they disagree. Skein does that in one call. It buys each check from
              independent miners on the Telegraph network, fuses them under a published policy, and returns one verdict:
              <strong className="text-ink"> APPROVE</strong>, <strong className="text-ink">REJECT</strong>,{" "}
              <strong className="text-ink">ESCALATE</strong> or <strong className="text-ink">ABSTAIN</strong>. Every input carries a receipt, and the
              whole decision carries a hash anyone can recompute.
            </P>
            <P>In this tutorial you will:</P>
            <Steps
              items={[
                ["Get a free quote with curl", "See what a verdict buys and costs, without an account."],
                ["Buy, stream and verify a verdict from TypeScript", <>With <C>@skeinlabs/sdk</C>, spend caps, typed errors and idempotency.</>],
                ["Pay per call through Telegraph", "No account at all: each verdict settles from your own escrow."],
                ["Hand the same tools to an AI agent", <>With <C>@skeinlabs/mcp</C> in Claude Code, Claude Desktop or Cursor.</>],
                ["Ship a listing gate", "A script that decides list, block, review or retry, and fails CI on a block."],
              ]}
            />
            <H3>What you need</H3>
            <ul className="mt-4 list-disc space-y-2 pl-6 text-[17px] leading-[1.7] text-ink-2">
              <li>Node.js 20 or later. The SDK also runs on Bun, Deno and edge runtimes: anything with <C>fetch</C>.</li>
              <li>
                For paid verdicts, one of: a <strong className="text-ink">partner key</strong> (free during the Telegraph hackathon;{" "}
                <A href={KEY_REQUEST}>request one</A>), or a <strong className="text-ink">funded Telegraph burner wallet</strong>, set up in{" "}
                <A href="#telegraph">section 09</A>.
              </li>
              <li>Quotes, verdict pages, event streams and verification are free and need neither.</li>
            </ul>
            <Note title="Not investment advice" tone="knot">
              A verdict is risk evidence for a listing decision. It is not a price prediction or a trading signal. Treat anything but
              APPROVE as &quot;do not proceed without a human&quot;.
            </Note>

            {/* 02 */}
            <H2 id="concepts" n="02 · Concepts">How a verdict works</H2>
            <P>
              A verdict is made in four steps, and each one leaves something you can check afterwards.
            </P>
            <Steps
              items={[
                ["Plan", <>The <A href="/policies">policy</A> (for example <C>dex-list@0.1.0</C>) names the checks it needs. Skein maps each to a Telegraph intent and prices it from the live miner catalogue.</>],
                ["Buy", "Each check is one paid Telegraph ask to an independent miner. Each answer comes back with a receipt hash and a signal hash."],
                ["Fuse", "The engine turns each raw answer into a finding, applies the policy's blockers, weights and conflict rules, and decides. Missing or failed required checks lead to ABSTAIN rather than a guess."],
                ["Seal", "The decision, the policy version, the engine version and a Merkle root over every receipt (the bill of materials) are hashed into the verdict hash."],
              ]}
            />
            <Table
              head={["Verdict", "Meaning", "What your code should do"]}
              rows={[
                ["APPROVE", "Every required check answered and nothing crossed a blocker.", "Proceed (list, pay out, trade)."],
                ["REJECT", "A blocker fired: in dex-list, a failed sanctions screen or a contract audit failing at high severity.", "Stop, and show the reasons."],
                ["ESCALATE", "Evidence is mixed or sources conflict.", "Send it to a human reviewer."],
                ["ABSTAIN", "Not enough evidence arrived to decide. Charged at upstream cost only.", "Retry later; never treat it as approval."],
              ]}
            />
            <P>
              Three numbers qualify the verdict. <C>riskBps</C> is how risky the token looks, from 0 to 10,000 basis points.{" "}
              <C>confidenceBps</C> is how sure the engine is, given what arrived. <C>coverage</C> is the share of the policy&apos;s checks
              that answered. A low-risk verdict with 40% coverage is weaker than it looks, and the policy accounts for that.
            </P>

            {/* 03 */}
            <H2 id="first-call" n="03 · First call">Your first call, with curl</H2>
            <P>
              Start with a quote. It is free and needs no key: it tells you which checks a verdict would buy for this token, from which
              Telegraph intents, at what upstream price, and what Skein charges. Here it is for WETH on Base:
            </P>
            <Block label="shell · free quote">{quoteCurl(API)}</Block>
            <Block label="response · 4 Nov 2026">{quoteResponse}</Block>
            <P>
              When a verdict would be refused (a required intent has no live miner, or the live floors are above your budget), the quote
              says so with <C>{'"ok": false'}</C> and a <C>refusal</C> code, before any money moves. A paid verdict over plain HTTP looks
              like this. You&apos;ll rarely write it by hand, because the SDK does it for you:
            </P>
            <Block label="shell · paid verdict (partner key)">{verdictCurl(API)}</Block>
            <P>
              The <C>Idempotency-Key</C> is required. Send the same key with the same body again and you get the original verdict back,
              marked <C>replayed</C>, and you are not charged twice. Send it with a different body and you get <C>409 IDEMPOTENCY_CONFLICT</C>.
            </P>

            {/* 04 */}
            <H2 id="install" n="04 · Install">Install the SDK</H2>
            <P>
              <C>@skeinlabs/sdk</C> is a small TypeScript client with no runtime dependencies. It wraps every endpoint and adds typed
              errors, retries that keep the idempotency key, and a spend cap checked before any payment.
            </P>
            <Block label="shell">{install}</Block>
            <Block label="typescript · quote.ts">{firstQuote(API)}</Block>

            {/* 05 */}
            <H2 id="verdict" n="05 · Verdict">Buy a verdict</H2>
            <P>
              Add a payer and call <C>verdict()</C>. With <C>maxUsdcPerCall</C> set, the SDK fetches a quote first and throws a{" "}
              <C>SpendCapError</C> if the price is above your cap, so nothing is paid. Then it submits the verdict, follows its event
              stream until it is sealed, and returns the full object.
            </P>
            <Block label="typescript · verdict.ts">{firstVerdict(API)}</Block>
            <H3>What comes back</H3>
            <Block label="typescript · the verdict object">{verdictShape}</Block>
            <P>
              Here is a real one. On 4 November, before Skein&apos;s own upstream wallet was funded, its purchases failed, and it did the
              right thing: it abstained, named every required check that was missing, and charged nothing.
            </P>
            <Block label="response · a real ABSTAIN">{realAbstain}</Block>
            <Note title="Pin the policy version">
              <C>dex-list</C> resolves to the latest published version; <C>dex-list@0.1.0</C> is fixed forever. Published policies are
              immutable, so pin the version you reviewed, and a policy change can never silently change your listings.
            </Note>

            {/* 06 */}
            <H2 id="stream" n="06 · Stream">Watch it being made</H2>
            <P>
              A verdict takes seconds, because each check is a separate paid ask. Pass <C>onEvent</C> to see each step as it happens. The
              same events drive the thread graph on every <A href="/console">verdict page</A>.
            </P>
            <Table
              head={["Event", "When", "Data"]}
              rows={[
                [<C key="p">plan</C>, "Before any purchase", "The checks and intents to buy, and their quotes"],
                [<C key="u">purchase</C>, "Each paid ask settles", "Check, miner, amount in micro-USDC, receipt hash, or an error"],
                [<C key="f">finding</C>, "Each answer is parsed", "Check, status (PASS, WARN, FAIL, UNKNOWN, UNAVAILABLE, ERROR), severity, value, notes"],
                [<C key="d">decision</C>, "The engine decides", "Verdict, risk, and the verdict hash"],
                [<C key="o">done</C>, "Sealed and stored", "The verdict id"],
                [<C key="r">refused</C>, "Refused before spending", "A refusal code and detail"],
              ]}
            />
            <Block label="typescript · live events">{onEvent}</Block>
            <P>
              For queue workers and serverless functions, split the call in two. <C>submit()</C> returns as soon as the verdict has an id;{" "}
              <C>wait()</C> collects it later, following the stream and falling back to polling if the connection drops.
            </P>
            <Block label="typescript · submit now, wait later">{submitWait}</Block>
            <Note title="Keep keys on the server">
              Call Skein from your backend and forward events to your own UI. A partner key must never ship to a browser, and the API
              only accepts cross-origin browser requests from Skein&apos;s own pages.
            </Note>

            {/* 07 */}
            <H2 id="verify" n="07 · Verify">Verify it</H2>
            <P>
              A verdict should not have to be trusted. <C>verify()</C> asks Skein to recompute it from the raw answers it paid for: re-run
              every adapter, re-apply the published policy, rebuild the receipts&apos; Merkle root, and compare the hashes. It is free,
              and it works on anyone&apos;s verdict, not only yours.
            </P>
            <Block label="typescript · verify and audit">{verifyCode}</Block>
            <P>
              Every verdict response also carries <C>X-Skein-Verdict-Hash</C> and <C>X-Skein-Bom-Root</C> headers, and the{" "}
              <A href="/verify">verify page</A> does the same check in a browser. Every receipt hash in the bill of materials is the one the
              Telegraph network returned for that purchase, so an auditor can trace each input to a settled payment.
            </P>

            {/* 08 */}
            <H2 id="production" n="08 · Production">Production patterns</H2>
            <H3>Cap spend in three places</H3>
            <P>
              <C>maxUsdcPerCall</C> refuses one expensive verdict. Your own running total, as in the listing gate below, caps a batch.
              And each partner key carries a daily cap on Skein&apos;s side, so a runaway loop stops there too. The Telegraph client adds a
              fourth: it will not sign a payment challenge above its own <C>maxUusdcPerCall</C>.
            </P>
            <H3>Make retries safe</H3>
            <P>
              Derive the idempotency key from what you are deciding, not from the attempt. For example, one key per token per day. A crash,
              a retry or a re-run then returns the same verdict without paying again. The SDK only retries a POST when it carries a key, and
              it never sleeps longer than <C>maxRetryWaitMs</C> in total: a <C>Retry-After</C> until midnight throws at once instead of
              hanging your worker.
            </P>
            <Block label="typescript · every option">{options(API)}</Block>
            <H3>Handle every outcome</H3>
            <P>
              All errors are <C>SkeinError</C>, with the API&apos;s code. A <C>SpendCapError</C> means nothing was paid. A{" "}
              <C>SkeinError</C> with a <C>payment</C> field means money moved (or may have) without a verdict, which can happen on the
              Telegraph rail, so count it against your caps.
            </P>
            <Block label="typescript · error handling">{errorsCode}</Block>
            <Table
              head={["Code", "HTTP", "Meaning"]}
              rows={[
                [<C key="1">INVALID_SUBJECT</C>, "400", "Unknown chain, or a malformed token address"],
                [<C key="2">UNKNOWN_POLICY</C>, "400", "No published policy by that id and version"],
                [<C key="3">PAYMENT_REQUIRED</C>, "402", "No partner key sent: send one, or pay through Telegraph"],
                [<C key="4">UNAUTHORIZED</C>, "401", "Unknown or revoked partner key"],
                [<C key="5">IDEMPOTENCY_CONFLICT</C>, "409", "The key was used before with a different body"],
                [<C key="6">BUDGET_TOO_LOW</C>, "422", "Live floors exceed your budget; refused before any spend"],
                [<C key="7">RATE_LIMITED</C>, "429", "Slow down; Retry-After says how long"],
                [<C key="8">UPSTREAM_UNAVAILABLE</C>, "503", "A required intent has no live miner right now"],
                [<C key="9">DAILY_CAP_REACHED</C>, "503", "Skein's own spend cap for the day is used up"],
                [<C key="10">TIMEOUT</C>, "504", "Upstream answers did not arrive in time; call wait(id) again"],
                [<C key="11">SPEND_CAP</C>, "SDK", "The quote is above your maxUsdcPerCall; nothing was paid"],
              ]}
            />
            <H3>Cache what the network caches</H3>
            <P>
              A verdict for the same token and policy within ten minutes is served from cache, marked <C>cached</C>, and buys nothing
              upstream. That is fine for a listing review, and it is why the listing gate checks <C>cached</C> and <C>replayed</C> before
              adding to its spend.
            </P>

            {/* 09 */}
            <H2 id="telegraph" n="09 · Telegraph">Pay per call, with no account</H2>
            <P>
              Skein is itself a miner on Telegraph, so any Telegraph app can buy a verdict with one paid ask, settled from its own escrow.
              There is no key to request: you need a wallet with test USDC in the Telegraph escrow on Sepolia.
            </P>
            <Note title="Status" tone="knot">
              Skein&apos;s miner registration on the Telegraph testnet is being completed. Until the <A href="/status">status page</A> lists it
              as active with its registration id, use a partner key. The code below works unchanged once it is: set{" "}
              <C>SKEIN_MINER_ID</C> to that id.
            </Note>
            <H3>Fund a burner</H3>
            <Block label="shell · Sepolia, with Foundry's cast">{burner}</Block>
            <Note title="Use a burner" tone="reject">
              The payer key signs payment authorisations. Use a fresh wallet that only ever holds a few test USDC, keep its key in your
              secret store, and never reuse a wallet that holds anything of value.
            </Note>
            <H3>Pay for a verdict</H3>
            <Block label="typescript · telegraph.ts">{telegraphCode(API)}</Block>
            <P>
              The client reads the network&apos;s <C>402</C> challenge and checks every field of the message it is asked to sign against
              the challenge itself. It refuses anything above its cap, signs with EIP-191, and never retries a call it has already paid
              for. The result&apos;s <C>payment</C> carries the receipt hash of your own purchase, and the verdict&apos;s bill of materials
              carries the receipts of every purchase Skein made upstream.
            </P>

            {/* 10 */}
            <H2 id="mcp" n="10 · MCP">Give it to an agent</H2>
            <P>
              <C>@skeinlabs/mcp</C> is a Model Context Protocol server that gives any MCP client three tools: <C>skein_quote</C> (free),{" "}
              <C>skein_verdict</C> (paid) and <C>skein_verify</C> (free). It pays inside, with a per-call cap and a per-session cap, so an
              agent cannot overspend however it loops. And it returns each verdict as a few lines the model can act on, plus the full object
              as structured content.
            </P>
            <H3>Claude Code</H3>
            <Block label="shell">{claudeCode}</Block>
            <H3>Claude Desktop, Cursor and others</H3>
            <P>
              Add the server to the client&apos;s MCP config. That&apos;s <C>claude_desktop_config.json</C> for Claude Desktop (Settings →
              Developer → Edit Config), <C>~/.cursor/mcp.json</C> or a project&apos;s <C>.cursor/mcp.json</C> for Cursor, and the same shape
              for most other clients. Then restart the client.
            </P>
            <Block label="json · mcp config">{desktop}</Block>
            <Table
              head={["Variable", "Default", "Meaning"]}
              rows={[
                [<C key="a">SKEIN_API_KEY</C>, "", "A partner key"],
                [<C key="b">SKEIN_PAYER_KEY</C>, "", "Instead of a key: a funded Telegraph burner"],
                [<C key="c">SKEIN_MINER_ID</C>, "", "Pin Skein's miner on Telegraph"],
                [<C key="d">SKEIN_MAX_USDC_PER_CALL</C>, "0.30", "No verdict is bought above this"],
                [<C key="e">SKEIN_SESSION_CAP_USDC</C>, "2", "What one server process may spend in total"],
                [<C key="f">SKEIN_API_URL</C>, "api.skeinlabs.site", ""],
              ]}
            />
            <H3>What it looks like</H3>
            <Block label="a conversation, abridged">{prompt}</Block>
            <Note title="Tell the agent the rule">
              The tool description already says to treat anything but APPROVE as &quot;do not proceed without a human&quot;. Put the same
              rule in your system prompt, and have the agent link the verdict page whenever it reports a decision.
            </Note>

            {/* 11 */}
            <H2 id="listing-gate" n="11 · Build it">Build the listing gate</H2>
            <P>
              Now put it together. The gate takes a list of tokens, checks each one within a per-run budget, verifies every verdict, and
              maps it to a decision. It writes <C>decisions.json</C> and exits with status 1 if anything is blocked, so a CI job or a
              listing pipeline can stop on it. The whole program is about a hundred lines;{" "}
              <A href={`${EXAMPLE.replace("/tree/", "/blob/")}/gate.ts`}>read it on GitHub</A>. Here is its core:
            </P>
            <Block label="typescript · gate.ts (core)">{gateCore}</Block>
            <Block label="shell · run it">{gateRun}</Block>
            <H3>Run it on every listing request</H3>
            <P>
              Keep the tokens you list in a file, and let a pull request that adds one run the gate. A block fails the check. A review shows
              up in the uploaded decisions, with a link to each verdict page for whoever approves the PR.
            </P>
            <Block label="yaml · github actions">{ciYaml}</Block>

            {/* 12 */}
            <H2 id="troubleshooting" n="12 · Troubleshooting">Troubleshooting</H2>
            <Table
              head={["Symptom", "Cause and fix"]}
              rows={[
                [<C key="1">NO_PAYER</C>, <>The client has no <C>payer</C>. Quotes and verification work without one; verdicts need a key or a Telegraph client.</>],
                [<C key="2">PAYMENT_REQUIRED</C>, <>No <C>Authorization: Bearer</C> header. Check that the key is in your environment.</>],
                [<C key="3">UNAUTHORIZED</C>, <>The key is unknown or revoked. Keys start with <C>sk_part_</C>; <A href={KEY_REQUEST}>request a new one</A>.</>],
                ["Every verdict is ABSTAIN", <>The required checks did not answer: see <C>reasons</C> and <C>openRisks</C>, and the <A href="/status">status page</A> for which intents have live miners. You are charged upstream cost only.</>],
                [<C key="5">UPSTREAM_UNAVAILABLE</C>, "A required intent has no live miner right now. Retry later, or choose a policy that does not require it."],
                [<C key="6">TIMEOUT</C>, <>Upstream answers were slow. The verdict may still seal: call <C>wait(id)</C> with the id from the error&apos;s <C>details</C>.</>],
                ["Telegraph: insufficient balance", <>Deposit more test USDC into escrow (section 09, step 4) and check <C>effectiveBalance</C>.</>],
                ["Telegraph: challenge refused", <>The price was above your client&apos;s <C>maxUusdcPerCall</C>, or the challenge failed its checks. Nothing was signed.</>],
                ["MCP tools don't appear", <>Restart the client after editing its config, and check its MCP log: the server prints <C>skein-mcp ready</C> to stderr.</>],
              ]}
            />

            {/* 13 */}
            <H2 id="next" n="13 · Next">Where next</H2>
            <ul className="mt-6 grid gap-px bg-rule sm:grid-cols-2">
              {(
                [
                  ["Run one in the console", "/console", "Watch the threads form, then open the verdict page."],
                  ["Read the policies", "/policies", "Every blocker, weight and threshold, versioned and immutable."],
                  ["API reference", "/docs#endpoints", "Every endpoint and error code."],
                  ["Source and issues", REPO, "Apache-2.0. Issues and pull requests welcome."],
                ] as [string, string, string][]
              ).map(([t, href, line]) => (
                <li key={href} className="bg-paper">
                  <a href={href} className="group flex h-full items-start justify-between gap-4 p-6 hover:bg-mist">
                    <span>
                      <span className="block text-[19px] text-ink">{t}</span>
                      <span className="mt-1 block text-[15px] text-ink-2">{line}</span>
                    </span>
                    <span className="mt-1 text-thread-deep transition-transform group-hover:translate-x-1"><IconArrow size={20} /></span>
                  </a>
                </li>
              ))}
            </ul>
            <P>
              Packages: <A href="https://www.npmjs.com/package/@skeinlabs/sdk">@skeinlabs/sdk</A> ·{" "}
              <A href="https://www.npmjs.com/package/@skeinlabs/mcp">@skeinlabs/mcp</A>. Found a mistake in this tutorial?{" "}
              <A href={`${REPO}/issues/new`}>Open an issue</A>.
            </P>
          </article>
        </div>
      </section>
    </>
  );
}
