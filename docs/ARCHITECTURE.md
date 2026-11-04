# Architecture

```
            ┌────────────────────────── consumers ──────────────────────────┐
            │  web (Next.js, Netlify)   Desk (Next.js, Netlify)   MCP / SDK  │
            └──────────────┬────────────────────┬────────────────────┬──────┘
                           │ HTTPS               │ @skeinlabs/sdk         │
                           ▼                     ▼                    ▼
   Telegraph dispatcher ─► API (Hono, Railway) ─ /v1/* and /miner/verdict
                           │  VerdictService: claim run → plan → buy → decide → seal
                           │                     │
                           │        pipeline ────┼──► Telegraph node (escrow 402 → X-PAYMENT → receipt)
                           │        engine (pure)│      └─ upstream miners (audit, sanctions, liquidity, …)
                           ▼                     ▼
                     Postgres (Railway): verdict_runs · spend_holds · purchases · findings · verdicts · events
```

## One verdict

1. **Claim.** `verdict_runs` gets a row first; with an Idempotency-Key the claim
   is atomic, so a retry never buys twice.
2. **Plan** (`packages/engine/src/plan.ts`, pure). Which checks to buy, from
   which live intents, within the policy's budget and the margin guard. Refuses
   before spending when a required check has no miner or the budget is short.
3. **Buy** (`packages/pipeline`). Each purchase gets an allotment of the
   verdict's cap, holds daily spend in `spend_holds` under an advisory lock,
   and is signed only if the 402's template, payee, network, amount and asset
   all check out (`packages/telegraph/src/escrow.ts`). A paid call is never
   retried. Each purchase is written as soon as it settles. Receipts are checked
   against the signed payment; signals are looked up on the node.
4. **Decide** (`packages/engine`, pure). Adapters turn answers into findings
   (refusing answers about another token or pool), the policy's thresholds
   grade them, and the decision table (blockers, missing evidence, coverage,
   risk, contradictions, required failures) gives the verdict.
5. **Seal.** The verdict hash covers the engine version, the policy and its
   file hash, the subject, the sorted findings and the decision; the BOM root is
   a domain-separated Merkle root of the receipts. Replay uses the engine that
   sealed it (`src/frozen/` keeps old versions).

## Where the money is guarded

| Guard | Where |
|---|---|
| Per-call ceiling (no 402 signed above it) | `MAX_USDC_PER_CALL` → `TelegraphClient` |
| Per-purchase allotment within the verdict cap | `packages/pipeline/src/verdict.ts` |
| Daily cap, per-key cap, Telegraph-channel cap, atomic | `spendGate` in `packages/db/src/store.ts` |
| No retry after X-PAYMENT; paid failures counted | `packages/telegraph/src/client.ts` |
| Pre-season refusal | `TelegraphClient.ask` |
| Desk: one agent per application (lease), one ask | `apps/desk/lib/agent.ts` |
| MCP: per-call and per-session caps, reserved | `packages/mcp/src/server.ts` |

## Packages

`engine` (pure decision logic) · `policies` (versioned YAML, lock-checked) ·
`telegraph` (client, escrow, fake node) · `pipeline` (purchasing) · `db`
(schema, store, spend gate) · `sdk` · `mcp` · `ui` (shared design system) ·
`apps/api` · `apps/web` · `apps/desk` · `miner` (registration tools) · `eval`
(benchmark harness) · `e2e` (browser tests).
