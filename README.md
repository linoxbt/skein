# Skein

**One request. Every thread.**

Skein is a Telegraph miner that sells one decision: whether an EVM token is fit
to list. To make it, Skein buys ranked checks from other miners (contract audit,
sanctions, holder distribution, liquidity, wash trading, and optionally social
and code review), fuses them with deterministic rules, and returns APPROVE,
REJECT, ESCALATE or ABSTAIN. Each verdict comes with reasons, the risks still
open, confidence, cost and a verifiable bill of materials.

> Status: week 0 of the build (Oct 29–31). The decision engine, policies and
> network facts are built and tested. The API, worker, web app and Skein Desk come
> next. No event-period transactions have been made.

## Layout

```
packages/
  engine/     planner, adapters, scoring, reconcile, decide, seal, reproduce
              (pure TypeScript, no network calls)
  policies/   versioned YAML policies, immutable once published (policies.lock.json)
  telegraph/  intent map, provider families, miner allowlist, catalogue snapshot
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

Reused libraries: `zod`, `@noble/hashes`, `yaml`, `vitest`, `fast-check`,
`turbo`, `tsx`. No templates were used.
