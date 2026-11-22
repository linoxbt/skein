# Skein benchmark


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Prospective

Prospective: each verdict was bought before the outcome was known, and the label comes from what happened afterwards. This is the point-in-time measure.

480 of 480 cases have a run (good 0, bad 221, ambiguous 259). 

**No case in this set is labelled good**, so a low false-APPROVE rate cannot be told apart from never approving: read it next to the APPROVE column.

| System | APPROVE (all) | APPROVE on good | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | Coverage |
|---|---|---|---|---|---|---|---|---|---|
| skein | 0.0% | n/a | 0.0% (95% CI 0.0%–1.7%) | 79.2% | 46.6% (95% CI 40.1%–53.2%) | 17.3% | 55.6% | $0.037 | 58.0% |
| single_best | 44.8% | n/a | 27.6% (95% CI 22.1%–33.8%) | 20.0% | 0.5% (95% CI 0.1%–2.5%) | 25.2% | 29.0% | $0.007 | 71.0% |
| weighted_avg | 59.4% | n/a | 36.7% (95% CI 30.6%–43.2%) | 80.6% | 13.1% (95% CI 9.3%–18.2%) | 33.1% | 0.0% | $0.037 | 58.0% |
| cheapest | 0.8% | n/a | 1.4% (95% CI 0.5%–3.9%) | 79.2% | 46.6% (95% CI 40.1%–53.2%) | 16.5% | 55.6% | $0.035 | 61.2% |

Latency (Skein's wall time; the baselines reuse the same runs): p50 4562 ms, p95 5874 ms.

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
Intervals are 95% Wilson score intervals on the counts behind each rate.
