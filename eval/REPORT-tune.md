# Skein benchmark (tune)


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Current state

Current state: each token was checked as it is today, because the miners Skein buys from read only current state. A rug drained long ago fails liquidity trivially, so this measures whether Skein would stop a listing today, not whether it would have caught the token before its event.

44 of 44 cases have a run (good 21, bad 23, ambiguous 0). 

| System | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | p50 / p95 latency | Coverage |
|---|---|---|---|---|---|---|---|---|
| skein | 0.0% (95% CI 0.0%–0.0%) | 84.6% | 47.8% (95% CI 28.0%–68.2%) | 18.2% | 36.4% | $0.048 | 4962 / 6668 ms | 56.4% |
| single_best | 13.0% (95% CI 0.0%–27.8%) | 80.0% | 52.2% (95% CI 31.8%–72.7%) | 47.7% | 4.5% | $0.010 | 4962 / 6668 ms | 95.5% |
| weighted_avg | 17.4% (95% CI 4.0%–33.3%) | 92.3% | 52.2% (95% CI 31.8%–72.7%) | 20.5% | 0.0% | $0.048 | 4962 / 6668 ms | 56.4% |
| cheapest | 0.0% (95% CI 0.0%–0.0%) | 84.6% | 47.8% (95% CI 28.0%–68.2%) | 4.5% | 36.4% | $0.037 | 4962 / 6668 ms | 75.5% |

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
