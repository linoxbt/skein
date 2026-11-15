# Skein benchmark


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Prospective

Prospective: each verdict was bought before the outcome was known, and the label comes from what happened afterwards. This is the point-in-time measure.

200 of 200 cases have a run (good 0, bad 108, ambiguous 92). 

**No case in this set is labelled good**, so a low false-APPROVE rate cannot be told apart from never approving: read it next to the APPROVE column.

| System | APPROVE (all) | APPROVE on good | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | Coverage |
|---|---|---|---|---|---|---|---|---|---|
| skein | 0.0% | n/a | 0.0% (95% CI 0.0%–3.4%) | 85.1% | 37.0% (95% CI 28.5%–46.4%) | 41.5% | 35.0% | $0.040 | 62.8% |
| single_best | 51.5% | n/a | 36.1% (95% CI 27.7%–45.5%) | 33.3% | 0.9% (95% CI 0.2%–5.1%) | 20.0% | 27.0% | $0.008 | 73.0% |
| weighted_avg | 45.0% | n/a | 28.7% (95% CI 21.0%–37.9%) | 85.3% | 26.9% (95% CI 19.4%–35.9%) | 38.0% | 0.0% | $0.040 | 62.8% |
| cheapest | 2.0% | n/a | 2.8% (95% CI 0.9%–7.9%) | 85.1% | 37.0% (95% CI 28.5%–46.4%) | 39.5% | 35.0% | $0.034 | 70.5% |

Latency (Skein's wall time; the baselines reuse the same runs): p50 4979 ms, p95 6061 ms.

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
Intervals are 95% Wilson score intervals on the counts behind each rate.
