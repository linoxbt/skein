# Skein benchmark (tune)


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Current state

Current state: each token was checked as it is today, because the miners Skein buys from read only current state. A rug drained long ago fails liquidity trivially, so this measures whether Skein would stop a listing today, not whether it would have caught the token before its event.

41 of 41 cases have a run (good 21, bad 20, ambiguous 0). 

| System | APPROVE (all) | APPROVE on good | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | Coverage |
|---|---|---|---|---|---|---|---|---|---|
| skein | 17.1% | 33.3% | 0.0% (95% CI 0.0%–16.1%) | 100.0% | 40.0% (95% CI 21.9%–61.3%) | 24.4% | 39.0% | $0.048 | 57.0% |
| single_best | 14.6% | 14.3% | 15.0% (95% CI 5.2%–36.0%) | 75.0% | 45.0% (95% CI 25.8%–65.8%) | 51.2% | 4.9% | $0.010 | 95.1% |
| weighted_avg | 53.7% | 85.7% | 20.0% (95% CI 8.1%–41.6%) | 90.0% | 45.0% (95% CI 25.8%–65.8%) | 22.0% | 0.0% | $0.048 | 57.0% |
| cheapest | 31.7% | 61.9% | 0.0% (95% CI 0.0%–16.1%) | 100.0% | 40.0% (95% CI 21.9%–61.3%) | 9.8% | 39.0% | $0.038 | 76.1% |

Latency (Skein's wall time; the baselines reuse the same runs): p50 4962 ms, p95 6668 ms.

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
Intervals are 95% Wilson score intervals on the counts behind each rate.
