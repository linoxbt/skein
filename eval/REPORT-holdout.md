# Skein benchmark (holdout)


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Current state

Current state: each token was checked as it is today, because the miners Skein buys from read only current state. A rug drained long ago fails liquidity trivially, so this measures whether Skein would stop a listing today, not whether it would have caught the token before its event.

20 of 20 cases have a run (good 13, bad 7, ambiguous 0). A sample of 20 is small; read the intervals, not the point estimates.

| System | APPROVE (all) | APPROVE on good | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | Coverage |
|---|---|---|---|---|---|---|---|---|---|
| skein | 20.0% | 30.8% | 0.0% (95% CI 0.0%–35.4%) | 100.0% | 42.9% (95% CI 15.8%–75.0%) | 25.0% | 40.0% | $0.049 | 58.4% |
| single_best | 20.0% | 23.1% | 14.3% (95% CI 2.6%–51.3%) | 62.5% | 71.4% (95% CI 35.9%–91.8%) | 25.0% | 15.0% | $0.010 | 85.0% |
| weighted_avg | 55.0% | 76.9% | 14.3% (95% CI 2.6%–51.3%) | 100.0% | 85.7% (95% CI 48.7%–97.4%) | 15.0% | 0.0% | $0.049 | 58.4% |
| cheapest | 35.0% | 53.8% | 0.0% (95% CI 0.0%–35.4%) | 100.0% | 42.9% (95% CI 15.8%–75.0%) | 10.0% | 40.0% | $0.038 | 76.4% |

Latency (Skein's wall time; the baselines reuse the same runs): p50 4935 ms, p95 19251 ms.

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
Intervals are 95% Wilson score intervals on the counts behind each rate.
