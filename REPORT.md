# Skein benchmark


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Prospective

Prospective: each verdict was bought before the outcome was known, and the label comes from what happened afterwards. This is the point-in-time measure.

80 of 80 cases have a run (good 0, bad 49, ambiguous 31). 

| System | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | p50 / p95 latency | Coverage |
|---|---|---|---|---|---|---|---|---|
| skein | 0.0% (95% CI 0.0%–0.0%) | 82.6% | 38.8% (95% CI 25.5%–52.8%) | 56.3% | 15.0% | $0.050 | 5013 / 6061 ms | 73.8% |
| single_best | 34.7% (95% CI 22.4%–48.0%) | 33.3% | 2.0% (95% CI 0.0%–6.5%) | 27.5% | 15.0% | $0.010 | 5013 / 6061 ms | 85.0% |
| weighted_avg | 16.3% (95% CI 6.5%–27.1%) | 83.3% | 40.8% (95% CI 27.3%–55.3%) | 53.8% | 0.0% | $0.050 | 5013 / 6061 ms | 73.8% |
| cheapest | 6.1% (95% CI 0.0%–13.7%) | 82.6% | 38.8% (95% CI 25.5%–52.8%) | 51.2% | 15.0% | $0.040 | 5013 / 6061 ms | 86.6% |

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
