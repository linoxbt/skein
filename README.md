# Skein

**One request. Every thread.**

Skein is a Telegraph miner that sells one decision: whether an EVM token is fit
to list. To make it, Skein buys ranked checks from other miners (contract audit,
sanctions, holder distribution, liquidity, wash trading, and optionally social
and code review), fuses them with deterministic rules, and returns APPROVE,
REJECT, ESCALATE or ABSTAIN. Each verdict comes with reasons, the risks still
open, confidence, cost and a verifiable bill of materials.

> **Status (Nov 8).** Built, tested and deployed: the decision engine and
> policies, the escrow-paying Telegraph client, the purchasing pipeline and
> CLI, the Postgres store, the HTTP API and miner endpoint (Railway), the web app
> and Skein Desk (Netlify), `@skeinlabs/sdk`, `@skeinlabs/mcp`, miner tooling, the
> benchmark harness and browser tests. Independent audits on Nov 2 (D14) and
> Nov 8 (production readiness, L24–L29) and their fixes are in docs/DECISIONS.md;
> operations are in [docs/RUNBOOK.md](docs/RUNBOOK.md).
>
> **Live on Telegraph (Nov 7).** Skein is a registered, active miner:
> registration **5137**, catalogue id **845301**, slug `skein-listing-verdict`,
> intent `FRAUD_RISK_GENERAL`, 0.25 USDC an answer. Any Telegraph agent can buy
> a verdict with one paid ask (`POST /engine/v1/ask/845301`), with no account
> and no key. The first such ask (Nov 7) paid 0.25 USDC, Skein bought its checks
> from other miners with escrow payments, and the node holds the signal. Verdicts
> on fresh Base launches now decide (REJECT, ESCALATE) rather than abstain:
> see docs/DECISIONS.md L24.
>
> **Benchmark (Nov 8).** On 20 held-out tokens, run once after the rules were
> frozen, Skein approved none of 7 documented scams and rejected none of 13
> long-listed tokens. Two simpler rules applied to the same paid findings each
> let one scam through. Skein abstained on 8 of 20. Small sample, current-state
> basis: see [eval/FINDINGS-holdout.md](eval/FINDINGS-holdout.md).
>
> **Pay per verdict, no account (x402).** With `X402_PAY_TO` set, `POST
> /v1/verdicts` without a partner key answers 402 with standard x402 terms
> (0.25 USDC on Base Sepolia), and any x402 client pays and gets the verdict.
> The payment settles only once a verdict is sealed (docs/DECISIONS.md L30).
>
> **Not done yet:** the prospective benchmark (the sniper's launches, labelled
> 72 hours later) starts producing cases from Nov 11. See
> docs/REVIEWER_GUIDE.md for what to try.

**[Watch the 3-minute demo film →](docs/demo/skein-motion.mp4)**: what Skein
does and why, with a real listing application decided live by an agent that pays
Telegraph miners, then verified. The plain screen walkthrough is
[here](docs/demo/skein-demo.mp4).

## Use it

Without an account, pay per verdict with any x402 client:

```ts
import { wrapFetchWithPayment } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";

// x402-fetch refuses to pay over 0.10 USDC unless told otherwise; a verdict is 0.25.
const pay = wrapFetchWithPayment(fetch, privateKeyToAccount(process.env.PAYER_KEY as `0x${string}`), 250_000n);
const res = await pay("https://api.skeinlabs.site/v1/verdicts", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ subject: { chainId: 8453, token: "0x…" } }),
});
// 200 with the signed verdict; X-PAYMENT-RESPONSE carries the settlement transaction.
```

**[Tutorial: build a listing gate with Skein →](https://skeinlabs.site/tutorial)**
From a free quote to a verified paid verdict, paying per call through
Telegraph, and the same tools for Claude or Cursor over MCP.

```sh
npm install @skeinlabs/sdk                                    # TypeScript client
claude mcp add skein --env SKEIN_API_KEY=sk_part_… -- npx -y @skeinlabs/mcp   # MCP server
```

```ts
import { Skein } from "@skeinlabs/sdk";

const skein = new Skein({ apiUrl: "https://api.skeinlabs.site", payer: { kind: "apiKey", key }, maxUsdcPerCall: 0.3 });
const v = await skein.verdict({ subject: { chainId: 8453, token: "0x…" } });
if (v.verdict !== "APPROVE") holdForReview(v.reasons);
```

Partner keys are free during the hackathon:
[request one](https://github.com/linoxbt/skein/issues/new?template=partner-key.yml).
A runnable example is in [`examples/listing-gate`](examples/listing-gate).

**API reference:** the OpenAPI 3.1 document is served at
[`/v1/openapi.json`](https://api.skeinlabs.site/v1/openapi.json); load it into
any OpenAPI viewer or client generator. Every error has the shape
`{ error: { code, message, requestId } }`, and every response carries `X-Request-Id`.

**Webhooks** (SDK 0.3.0+) tell you when an async verdict is sealed, instead of polling:

```ts
const { secret } = await skein.setWebhook("https://you.example/skein");   // shown once: store it
// in your handler, with the raw request body:
import { verifyWebhook } from "@skeinlabs/sdk/webhooks";
if (!(await verifyWebhook(rawBody, req.headers["x-skein-signature"], secret))) return res.status(401).end();
```

Deliveries are POSTs carrying `X-Skein-Event` (`verdict.done`, `verdict.refused`)
and `X-Skein-Signature: sha256=…`, an HMAC of the body. The URL must be public
https; it is checked again before each delivery, and redirects are not followed.
`skein.webhook()` shows the current one, and `skein.deleteWebhook()` turns it off.

## Layout

```
packages/
  engine/     planner, adapters, scoring, reconcile, decide, seal, reproduce
              (pure TypeScript, no network calls)
  policies/   versioned YAML policies, immutable once published (policies.lock.json)
  telegraph/  network config, escrow-paying client, intent map, provider families,
              miner allowlist, catalogue snapshot, and a fake node for tests
  pipeline/   request builders, purchaser, runVerdict(); the verdict and repro CLIs
  db/         Drizzle schema and migrations (append-only evidence, RLS), verdict store
  sdk/        @skeinlabs/sdk: verdict(), quote(), verify(), stream(), submit()/wait(), typed
              errors, retries, spend cap; pays with a partner key or through Telegraph
  mcp/        @skeinlabs/mcp: stdio MCP server with skein_verdict, skein_quote, skein_verify
  ui/         shared design tokens and components (web and Desk)
apps/
  api/        Hono API: /v1/verdicts (+ /bom, /events SSE), /v1/verify, /v1/quote,
              /v1/status, /v1/ledger, /v1/policies, /v1/webhooks, /v1/openapi.json,
              /miner/verdict; Dockerfile
  web/        Next.js 15 console: live Exploded View, verdict pages, verify, policies,
              ledger, status, docs, tutorial; Dockerfile (standalone) or Netlify
  desk/       Skein Desk: a fictional exchange's listing queue; an agent buys a verdict
              per application and shortlists, declines or routes it to an analyst
miner/        skein-miner.yaml, validate.sh, tools.ts (escrow status/deposit, intent check,
              registration), intent proposal
eval/         benchmark harness (run, report, baselines, bootstrap) and replayable verdicts
e2e/          browser tests: console flow, verify, 375 px, axe WCAG 2 AA
scripts/      netlify-bundle.mjs: the self-contained upload each Netlify deploy is built from
docs/         DECISIONS.md, REVIEWER_GUIDE.md, ARCHITECTURE.md, DISCLOSURES.md, MAINNET.md
```

## Run

Requires Node 22 and pnpm 10.

```sh
pnpm install
pnpm typecheck
pnpm test                      # unit, adapter-contract and property tests
FC_RUNS=20000 pnpm --filter @skein/engine exec vitest run test/properties.test.ts --testTimeout=900000
pnpm policies:lock             # record a newly published policy version

# One verdict. Without --live it is SIMULATED (canned answers, labelled, never evidence).
pnpm verdict --chain 8453 --token 0x4200000000000000000000000000000000000006 --scenario conflict
pnpm repro out/verdicts/<file>.json   # re-run adapters and engine; exit 1 on any mismatch

# Local stack, no accounts: the real API on PGlite + a fake Telegraph node (all SIMULATED).
pnpm dev:api                   # http://localhost:8787, partner key sk_dev_local_simulated
NEXT_PUBLIC_SKEIN_API=http://localhost:8787 pnpm dev:web   # http://localhost:3000
# In the console: a token ending in "c" shows the conflict; the rest are clean.
SKEIN_API_URL=http://localhost:8787 DESK_SKEIN_KEY=sk_dev_local_simulated \
  pnpm --filter @skein/desk dev                            # http://localhost:3100

# MCP server for Claude Desktop, Cursor and others (stdio):
SKEIN_API_KEY=sk_part_… npx tsx packages/mcp/bin/skein-mcp.ts       # or, from npm: npx -y @skeinlabs/mcp

# API (needs Postgres). Migrations run on start (under an advisory lock).
DATABASE_URL=postgres://… pnpm --filter @skein/api start
DATABASE_URL=postgres://… pnpm --filter @skein/api partner:add "Team name" 2   # prints a key once
# Production's database is private: provision partner keys by hash instead, in the API's
# environment (SEED_CONSUMERS="name|kind|sha256|capUsdc,…", reconciled on every start),
# and revoke with REVOKED_KEY_HASHES.

# Browser tests and the benchmark
pnpm --filter @skein/e2e e2e                          # needs the web app on :3000 (see .github/workflows/ci.yml)
pnpm --filter @skein/eval eval report eval/cases.example.json eval/runs

# Live, from Nov 1: a burner key with test USDC deposited in escrow.
PURCHASER_PRIVATE_KEY=0x… pnpm verdict --live --chain 8453 --token 0x… --social <handle>
```

## Deployed

| Service | Host | URL |
|---|---|---|
| Web app | Netlify | https://skeinlabs.site (also https://skein-web.netlify.app) |
| API | Railway (Docker, `apps/api/Dockerfile`) | https://api.skeinlabs.site (also https://api-production-9396.up.railway.app) |
| Skein Desk | Netlify | https://desk.skeinlabs.site (also https://skein-desk.netlify.app) |
| Skein Sniper (Mission 14) | Railway (Docker, `apps/sniper/Dockerfile`) | https://sniper-production-bea6.up.railway.app |
| Postgres | Railway | private network only |

The API and the sniper deploy from `main` once CI is green (Railway's "wait
for CI"). The web app and
the Desk build from the repository with pnpm (`apps/*/netlify.toml`): link the
repo in Netlify with base directory `apps/web` or `apps/desk` and they deploy
on every push to `main` (docs/RUNBOOK.md, "Deploying"). A manual upload is
still possible, from a self-contained bundle made by the same script every
time, so a deployed site is always a commit:

```sh
node scripts/netlify-bundle.mjs apps/desk /tmp/desk-upload   # vendors @skein/* sources as file: deps
```

then run Netlify's deploy command from that folder. Incidents, rollback,
secret rotation and backups: [docs/RUNBOOK.md](docs/RUNBOOK.md).

### Releasing the npm packages

`@skeinlabs/sdk` and `@skeinlabs/mcp` are published by
`.github/workflows/release.yml` (Actions → Release packages → Run workflow, or
push a `v*` tag), with npm provenance. It needs the repository secret
`NPM_TOKEN`: an npm granular access token with write access to the
`@skeinlabs` scope. Bump `version` in the package's `package.json` first; a
version already on npm is skipped.

### Issuing a partner key

```sh
node scripts/issue-partner-key.mjs "Acme Launchpad" team 2 ./acme.key
# prints the SEED_CONSUMERS entry (name|kind|sha256|cap); the key is only in ./acme.key
```

Append the printed entry to `SEED_CONSUMERS` on the Railway api service and
send the key file's contents to the partner privately.

## How a verdict is decided

The rows are evaluated in order, and the first one that matches decides the
verdict:

| # | Condition | Verdict |
|---|---|---|
| 1 | A blocker hits (e.g. a sanctions match) | REJECT |
| 2 | A required check has no real answer | ABSTAIN (names the check) |
| 3 | Coverage is below the policy minimum | ABSTAIN |
| 4 | risk_bps ≥ reject threshold | REJECT |
| 5 | A contradiction fires (e.g. audit PASS, wash trading FAIL) | ESCALATE |
| 6 | A required check is at FAIL | ESCALATE |
| 7 | risk_bps < approve threshold and confidence ≥ minimum | APPROVE |
| 8 | Anything else | ESCALATE |

The same findings and policy version always produce the same verdict and the
same `verdictHash`: keccak256 of canonical JSON over the engine version, the
policy, the subject, the sorted findings and the decision. `bom.root` is the
Merkle root of the paid inputs' receipt hashes.

## Network

Tokens analysed are on mainnets (Ethereum, Base, BNB, Arbitrum). Payment and
registration happen on the Telegraph **testnet**. Verdicts are risk evidence,
not investment advice.

## Disclosures

Reused libraries: `zod`, `@noble/hashes`, `yaml`, `viem`, `drizzle-orm`,
`drizzle-kit`, `@electric-sql/pglite` (tests), `vitest`, `fast-check`, `turbo` and
`tsx`. No templates were used.

Non-Telegraph lookups: DexScreener's public token endpoint, used only to find a
token's main pool. The liquidity figure itself is bought through Telegraph.
