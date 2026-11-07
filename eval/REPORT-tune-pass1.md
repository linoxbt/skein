# Skein benchmark (tune)


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Current state

Current state: each token was checked as it is today, because the miners Skein buys from read only current state. A rug drained long ago fails liquidity trivially, so this measures whether Skein would stop a listing today, not whether it would have caught the token before its event.

44 of 44 cases have a run (good 21, bad 23, ambiguous 0). 

| System | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | p50 / p95 latency | Coverage |
|---|---|---|---|---|---|---|---|---|
| skein | 0.0% (95% CI 0.0%–0.0%) | 87.5% | 30.4% (95% CI 13.0%–50.0%) | 15.9% | 52.3% | $0.046 | 4791 / 6718 ms | 50.4% |
| single_best | 8.7% (95% CI 0.0%–20.8%) | 80.0% | 34.8% (95% CI 16.7%–54.2%) | 45.5% | 20.5% | $0.010 | 4791 / 6718 ms | 79.5% |
| weighted_avg | 34.8% (95% CI 15.8%–55.0%) | 88.9% | 34.8% (95% CI 16.7%–54.2%) | 18.2% | 0.0% | $0.046 | 4791 / 6718 ms | 50.4% |
| cheapest | 0.0% (95% CI 0.0%–0.0%) | 87.5% | 30.4% (95% CI 13.0%–50.0%) | 4.5% | 52.3% | $0.036 | 4791 / 6718 ms | 66.5% |

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
