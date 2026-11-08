# Skein benchmark (tune)


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Current state

Current state: each token was checked as it is today, because the miners Skein buys from read only current state. A rug drained long ago fails liquidity trivially, so this measures whether Skein would stop a listing today, not whether it would have caught the token before its event.

41 of 41 cases have a run (good 21, bad 20, ambiguous 0). 

| System | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | p50 / p95 latency | Coverage |
|---|---|---|---|---|---|---|---|---|
| skein | 0.0% (95% CI 0.0%–0.0%) | 100.0% | 40.0% (95% CI 19.0%–62.5%) | 24.4% | 39.0% | $0.048 | 4962 / 6668 ms | 57.0% |
| single_best | 15.0% (95% CI 0.0%–31.8%) | 75.0% | 45.0% (95% CI 23.8%–68.2%) | 51.2% | 4.9% | $0.010 | 4962 / 6668 ms | 95.1% |
| weighted_avg | 20.0% (95% CI 4.2%–38.9%) | 90.0% | 45.0% (95% CI 23.8%–68.2%) | 22.0% | 0.0% | $0.048 | 4962 / 6668 ms | 57.0% |
| cheapest | 0.0% (95% CI 0.0%–0.0%) | 100.0% | 40.0% (95% CI 19.0%–62.5%) | 9.8% | 39.0% | $0.038 | 4962 / 6668 ms | 76.1% |

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
