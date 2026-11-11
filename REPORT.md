# Skein benchmark


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Prospective

Prospective: each verdict was bought before the outcome was known, and the label comes from what happened afterwards. This is the point-in-time measure.

40 of 40 cases have a run (good 0, bad 27, ambiguous 13). 

| System | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | p50 / p95 latency | Coverage |
|---|---|---|---|---|---|---|---|---|
| skein | 0.0% (95% CI 0.0%–0.0%) | 88.9% | 59.3% (95% CI 40.7%–76.9%) | 40.0% | 15.0% | $0.050 | 5044 / 6151 ms | 66.8% |
| single_best | 22.2% (95% CI 8.0%–40.0%) | 50.0% | 3.7% (95% CI 0.0%–12.5%) | 25.0% | 30.0% | $0.010 | 5044 / 6151 ms | 70.0% |
| weighted_avg | 22.2% (95% CI 8.0%–40.0%) | 89.5% | 63.0% (95% CI 44.4%–80.0%) | 32.5% | 0.0% | $0.050 | 5044 / 6151 ms | 66.8% |
| cheapest | 11.1% (95% CI 0.0%–25.0%) | 88.9% | 59.3% (95% CI 40.7%–76.9%) | 30.0% | 15.0% | $0.040 | 5044 / 6151 ms | 78.5% |

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
