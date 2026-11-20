# Skein benchmark


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Prospective

Prospective: each verdict was bought before the outcome was known, and the label comes from what happened afterwards. This is the point-in-time measure.

400 of 400 cases have a run (good 0, bad 193, ambiguous 207). 

**No case in this set is labelled good**, so a low false-APPROVE rate cannot be told apart from never approving: read it next to the APPROVE column.

| System | APPROVE (all) | APPROVE on good | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | Coverage |
|---|---|---|---|---|---|---|---|---|---|
| skein | 0.0% | n/a | 0.0% (95% CI 0.0%–2.0%) | 79.2% | 53.4% (95% CI 46.3%–60.3%) | 20.8% | 46.8% | $0.045 | 69.6% |
| single_best | 53.8% | n/a | 31.6% (95% CI 25.5%–38.5%) | 20.0% | 0.5% (95% CI 0.1%–2.9%) | 30.3% | 14.8% | $0.009 | 85.3% |
| weighted_avg | 51.2% | n/a | 27.5% (95% CI 21.7%–34.2%) | 80.6% | 15.0% (95% CI 10.7%–20.7%) | 39.8% | 0.0% | $0.045 | 69.6% |
| cheapest | 1.0% | n/a | 1.6% (95% CI 0.5%–4.5%) | 79.2% | 53.4% (95% CI 46.3%–60.3%) | 19.8% | 46.8% | $0.042 | 73.4% |

Latency (Skein's wall time; the baselines reuse the same runs): p50 4744 ms, p95 5854 ms.

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
Intervals are 95% Wilson score intervals on the counts behind each rate.
