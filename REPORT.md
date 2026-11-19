# Skein benchmark


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Prospective

Prospective: each verdict was bought before the outcome was known, and the label comes from what happened afterwards. This is the point-in-time measure.

360 of 360 cases have a run (good 0, bad 169, ambiguous 191). 

**No case in this set is labelled good**, so a low false-APPROVE rate cannot be told apart from never approving: read it next to the APPROVE column.

| System | APPROVE (all) | APPROVE on good | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | Coverage |
|---|---|---|---|---|---|---|---|---|---|
| skein | 0.0% | n/a | 0.0% (95% CI 0.0%–2.2%) | 78.0% | 50.3% (95% CI 42.8%–57.7%) | 23.1% | 46.7% | $0.044 | 68.8% |
| single_best | 55.0% | n/a | 32.5% (95% CI 25.9%–39.9%) | 20.0% | 0.6% (95% CI 0.1%–3.3%) | 27.8% | 15.8% | $0.009 | 84.2% |
| weighted_avg | 51.7% | n/a | 27.8% (95% CI 21.6%–35.0%) | 80.6% | 17.2% (95% CI 12.2%–23.6%) | 38.3% | 0.0% | $0.044 | 68.8% |
| cheapest | 1.1% | n/a | 1.8% (95% CI 0.6%–5.1%) | 78.0% | 50.3% (95% CI 42.8%–57.7%) | 21.9% | 46.7% | $0.041 | 73.1% |

Latency (Skein's wall time; the baselines reuse the same runs): p50 4761 ms, p95 5799 ms.

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
Intervals are 95% Wilson score intervals on the counts behind each rate.
