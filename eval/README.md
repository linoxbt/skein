# Evaluation

Skein only wins if it shows, on tokens it has never seen, that the fused
verdict beats each simpler alternative. Thresholds are frozen (policy 1.0.0)
before the held-out run, and every number is reported, including the bad ones.

## Labelled set

About 90 real mainnet tokens on Ethereum, Base and BNB, about 30 in each group:

- **good**: listed on two or more major exchanges for at least 6 months
- **bad**: documented honeypots, rugs and drainers, each with a public source
- **ambiguous**: new tokens with mixed signals

The set is split 60/30: thresholds are tuned on the first 60, and results are
reported on the held-out 30.

## Two bases, never pooled (docs/DECISIONS.md L26, replacing D7)

The miners Skein buys from read only current state, so a check cannot be asked
about a past block. Every case carries a `basis`, and the report gives each its own table:

- **current_state**: good tokens (long listed) and bad tokens (documented
  honeypots and rugs), checked as they are today. A rug drained long ago fails
  liquidity trivially, so this answers "would Skein stop this listing today",
  not "would it have caught the token in time".
- **prospective**: verdicts the sniper bought when a launch first reached
  tradeable liquidity, labelled 72 hours later from public market data: bad if
  the market is gone, its liquidity fell under a tenth, or its price fell 90% or
  more; ambiguous otherwise. This is the point-in-time measure: the verdict
  predates the outcome.

`asOfBlock` records the block the case describes: for prospective cases the
block when the verdict was bought, for current-state cases the block when the
case was collected.

## Case schema (`eval_cases`)

| Field | Notes |
|---|---|
| id | `case_###` |
| chain_id, token | the subject |
| label | good, bad, ambiguous |
| label_source_url | required for every label |
| label_event_at | when the rug, report or listing happened |
| as_of_block | the block the checks read |
| split | tune or holdout, fixed when the case is added |
| basis | `current_state` or `prospective` (see above) |
| verdictId | prospective only: the verdict bought before the outcome |
| notes | free text |

## Baselines

All baselines run on the same held-out set:
- **best single input**: the strongest check alone, using its own pass/fail
- **weighted average**: the same inputs, with no blockers, conflict rules or abstain
- **direct APIs**: the same checks wired straight to public APIs, outside Telegraph
- **cheapest config**: required checks only

Metrics: precision and recall on REJECT; the false-APPROVE rate on bad tokens
(the number that matters most); ESCALATE and ABSTAIN rates; cost per verdict;
p50 and p95 latency; coverage. Results carry bootstrap confidence intervals and
say plainly that 30 tokens is a small sample.

## Harness

```sh
# Buy one live verdict per case (real Telegraph inputs; capped; asks for --live --yes)
PURCHASER_PRIVATE_KEY=0x… pnpm --filter @skein/eval eval run eval/cases.json --split holdout \
  --out eval/runs --live --yes --max-total-usdc 5

# Prospective cases: label launches the sniper checked 72+ hours ago, then score the verdicts it bought then
pnpm --filter @skein/eval eval-tools prospective eval/sources/prospective.json
SKEIN_API_KEY=sk_… pnpm --filter @skein/eval eval import eval/sources/prospective.json --out eval/runs

# Score Skein and the baselines on the stored runs (Markdown, 95% bootstrap intervals)
pnpm --filter @skein/eval eval report eval/cases.json eval/runs --split holdout
```

`cases.example.json` shows the format and is marked `"kind": "example"`: the
report refuses to present example cases as results. The labelled set
(`cases.json`, about 90 cases, each with a public source URL and an
`asOfBlock`) is curated by hand; it is not generated.

Baselines (single best input, weighted average, cheapest configuration) are
recomputed from Skein's own paid findings, so they cost nothing extra and differ
only in the rule. The direct-API baseline needs its own data source and is not
computed yet.

`verdicts/` holds simulated verdicts (clean, conflict, timeout). CI replays
them with `pnpm repro eval/verdicts` on every push.
