# Skein

**One request. Every thread.**

Skein is a Telegraph miner that sells one decision: whether an EVM token is fit
to list. To make it, Skein buys ranked checks from other miners (contract audit,
sanctions, holder distribution, liquidity, wash trading, and optionally social
and code review), fuses them with deterministic rules, and returns APPROVE,
REJECT, ESCALATE or ABSTAIN. Each verdict comes with reasons, the risks still
open, confidence, cost and a verifiable bill of materials.

> Status: week 0 of the build (Oct 29–31). Built and tested so far:
> - the decision engine and policies
> - the escrow-paying Telegraph client
> - the purchaser pipeline, the `pnpm verdict` / `pnpm repro` CLI, and the
>   Postgres store
>
> - the HTTP API (deploys to Railway from `railway.json`)
>
> The web app and Skein Desk come next. No paid call has been made;
> the client refuses to pay before the season opens on Nov 1 (UTC).

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
apps/
  api/        Hono API: /v1/verdicts (+ /bom, /events SSE), /v1/verify, /v1/quote,
              /v1/status, /v1/ledger, /v1/policies, /miner/verdict; Dockerfile
miner/        draft skein-miner.yaml, validate.sh, intent proposal
eval/         labelled-set protocol (point-in-time)
docs/         DECISIONS.md: deviations from the build spec and live-network findings
```

## Run

Requires Node 22 and pnpm 10.

```sh
pnpm install
pnpm typecheck
pnpm test                      # unit, adapter-contract and property tests
FC_RUNS=20000 pnpm --filter @skein/engine exec vitest run test/properties.test.ts --testTimeout=300000
pnpm policies:lock             # record a newly published policy version

# One verdict. Without --live it is SIMULATED (canned answers, labelled, never evidence).
pnpm verdict --chain 8453 --token 0x4200000000000000000000000000000000000006 --scenario conflict
pnpm repro out/verdicts/<file>.json   # re-run adapters and engine; exit 1 on any mismatch

# API (needs Postgres). Migrations run on start.
DATABASE_URL=postgres://… pnpm --filter @skein/api start
DATABASE_URL=postgres://… pnpm --filter @skein/api partner:add "Team name" 2   # prints a key once

# Live, from Nov 1: a burner key with test USDC deposited in escrow.
PURCHASER_PRIVATE_KEY=0x… pnpm verdict --live --chain 8453 --token 0x… --social <handle>
```

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
