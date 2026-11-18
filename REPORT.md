# Skein benchmark


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Prospective

Prospective: each verdict was bought before the outcome was known, and the label comes from what happened afterwards. This is the point-in-time measure.

320 of 320 cases have a run (good 0, bad 161, ambiguous 159). 

**No case in this set is labelled good**, so a low false-APPROVE rate cannot be told apart from never approving: read it next to the APPROVE column.

| System | APPROVE (all) | APPROVE on good | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | Coverage |
|---|---|---|---|---|---|---|---|---|---|
| skein | 0.0% | n/a | 0.0% (95% CI 0.0%–2.3%) | 77.4% | 50.9% (95% CI 43.3%–58.5%) | 25.9% | 40.9% | $0.043 | 67.0% |
| single_best | 50.9% | n/a | 31.1% (95% CI 24.4%–38.6%) | 20.0% | 0.6% (95% CI 0.1%–3.4%) | 30.3% | 17.2% | $0.009 | 82.8% |
| weighted_avg | 47.2% | n/a | 26.1% (95% CI 19.9%–33.4%) | 80.6% | 18.0% (95% CI 12.8%–24.7%) | 41.6% | 0.0% | $0.043 | 67.0% |
| cheapest | 1.3% | n/a | 1.9% (95% CI 0.6%–5.3%) | 77.4% | 50.9% (95% CI 43.3%–58.5%) | 24.7% | 40.9% | $0.040 | 71.8% |

Latency (Skein's wall time; the baselines reuse the same runs): p50 4777 ms, p95 5854 ms.

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
Intervals are 95% Wilson score intervals on the counts behind each rate.
