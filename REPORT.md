# Skein benchmark


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Prospective

Prospective: each verdict was bought before the outcome was known, and the label comes from what happened afterwards. This is the point-in-time measure.

440 of 440 cases have a run (good 0, bad 219, ambiguous 221). 

**No case in this set is labelled good**, so a low false-APPROVE rate cannot be told apart from never approving: read it next to the APPROVE column.

| System | APPROVE (all) | APPROVE on good | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | Coverage |
|---|---|---|---|---|---|---|---|---|---|
| skein | 0.0% | n/a | 0.0% (95% CI 0.0%–1.7%) | 79.2% | 47.0% (95% CI 40.5%–53.6%) | 18.9% | 51.6% | $0.041 | 63.3% |
| single_best | 48.9% | n/a | 27.9% (95% CI 22.3%–34.1%) | 20.0% | 0.5% (95% CI 0.1%–2.5%) | 27.5% | 22.5% | $0.008 | 77.5% |
| weighted_avg | 55.7% | n/a | 36.1% (95% CI 30.0%–42.6%) | 80.6% | 13.2% (95% CI 9.4%–18.4%) | 36.1% | 0.0% | $0.041 | 63.3% |
| cheapest | 0.9% | n/a | 1.4% (95% CI 0.5%–3.9%) | 79.2% | 47.0% (95% CI 40.5%–53.6%) | 18.0% | 51.6% | $0.038 | 66.8% |

Latency (Skein's wall time; the baselines reuse the same runs): p50 4664 ms, p95 5936 ms.

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
Intervals are 95% Wilson score intervals on the counts behind each rate.
