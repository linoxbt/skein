# Skein benchmark (holdout)


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Current state

Current state: each token was checked as it is today, because the miners Skein buys from read only current state. A rug drained long ago fails liquidity trivially, so this measures whether Skein would stop a listing today, not whether it would have caught the token before its event.

20 of 20 cases have a run (good 13, bad 7, ambiguous 0). A sample of 20 is small; read the intervals, not the point estimates.

| System | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | p50 / p95 latency | Coverage |
|---|---|---|---|---|---|---|---|---|
| skein | 0.0% (95% CI 0.0%–0.0%) | 100.0% | 42.9% (95% CI 0.0%–83.3%) | 25.0% | 40.0% | $0.049 | 4935 / 19251 ms | 58.4% |
| single_best | 14.3% (95% CI 0.0%–44.4%) | 62.5% | 71.4% (95% CI 33.3%–100.0%) | 25.0% | 15.0% | $0.010 | 4935 / 19251 ms | 85.0% |
| weighted_avg | 14.3% (95% CI 0.0%–44.4%) | 100.0% | 85.7% (95% CI 55.6%–100.0%) | 15.0% | 0.0% | $0.049 | 4935 / 19251 ms | 58.4% |
| cheapest | 0.0% (95% CI 0.0%–0.0%) | 100.0% | 42.9% (95% CI 0.0%–83.3%) | 10.0% | 40.0% | $0.038 | 4935 / 19251 ms | 76.4% |

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
