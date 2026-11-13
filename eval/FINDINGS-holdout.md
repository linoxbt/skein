# Holdout result, 2026-11-08

The holdout split is 20 tokens that were set aside when the set was built (by a
hash of each case id). They were never looked at while the rules were tuned.
They were run **once**, after the rules were frozen in commit `4af3d04` (squash-merged; the reachable commit is `7604719`, "Benchmark: rules frozen, holdout run once")
(docs/DECISIONS.md L27): `dex-list@0.2.0` and `contract_audit@0.5.0`.
The run cost 0.97 test USDC, about 5 cents a verdict.
The generated numbers are in `REPORT-holdout.md`; the stored runs are in `runs/`.

**Basis: current state.** Each token was checked as it is today. This
measures whether Skein would stop the listing now, not whether it would have
caught the token before its event (L26).

## Result

| | Skein | Weighted average | Best single check |
|---|---|---|---|
| Bad tokens approved | **0 of 7** | 1 of 7 | 1 of 7 |
| Bad tokens rejected | 3 of 7 | 6 of 7 | 5 of 7 |
| Good tokens rejected | **0 of 13** | 0 of 13 | 3 of 13 |
| Abstained | 8 of 20 | 0 of 20 | 3 of 20 |

The baselines are recomputed from Skein's own paid findings, so they differ
only in the rule.

Skein's 20 verdicts:
- **Good, 13 tokens:** 4 APPROVE, 5 ESCALATE, 4 ABSTAIN, 0 REJECT.
- **Bad, 7 tokens:** 3 REJECT, 4 ABSTAIN, 0 APPROVE.

## What it means

- **Skein never approved a bad token, and never rejected a good one.** Both
  simpler rules let one of the seven scams through. The best single check (the
  audit alone) also rejected three of the thirteen good tokens.
- **The price is caution.** Skein decided 12 of 20 tokens and abstained on 8.
  Abstaining is not approving: a listing desk or a trading agent treats it as
  "do not list or trade yet". But it means a person, or a second source, is
  needed more often than with a simpler rule.
- **This agrees with the tune split** (41 tokens): 0 of 20 bad approved, REJECT
  precision 100%, abstention 39%.

## Limits, stated plainly

- **Seven bad tokens is a small sample.** The 95% interval on Skein's REJECT
  recall runs from 0% to 83%. The zero false approvals are what was observed,
  not a guarantee.
- **Current state flatters any system on long-dead rugs.** The prospective
  set is the real point-in-time test: the sniper's launches, labelled 72 hours
  after their verdicts. Its first cases can be labelled from 2026-11-11.
- **Abstentions have known causes:** rugged tokens with no market left, no
  holder-count miner for BNB Chain on the network, and GoPlus rate limits
  (FINDINGS-tune.md).
