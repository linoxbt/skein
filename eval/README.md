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

## Point-in-time evaluation (docs/DECISIONS.md, D7)

Labels describe events (a rug, a listing). A token's state today does not
describe its state at listing time. A rug that has been drained fails liquidity
trivially, and a token listed long ago passes trivially. So every case
carries an `as_of_block`:

- **bad**: a block before the label event (before the drain or the honeypot report)
- **good**: a block near the start of its 6 months on exchanges
- **ambiguous**: the block when the case was collected

Every check is asked for state at `as_of_block` where its miner supports it
(holder count, liquidity and Transfer-log scans can be read at a block). A check
that only reads current state is listed per case as `current_state_only`, and the
report shows results with and without those checks.

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
