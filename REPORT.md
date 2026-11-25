# Skein benchmark


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Prospective

Prospective: each verdict was bought before the outcome was known, and the label comes from what happened afterwards. This is the point-in-time measure.

600 of 600 cases have a run (good 0, bad 292, ambiguous 308). 

**No case in this set is labelled good**, so a low false-APPROVE rate cannot be told apart from never approving: read it next to the APPROVE column.

| System | APPROVE (all) | APPROVE on good | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | Coverage |
|---|---|---|---|---|---|---|---|---|---|
| skein | 0.7% | n/a | 0.7% (95% CI 0.2%–2.5%) | 85.6% | 54.8% (95% CI 49.1%–60.4%) | 21.8% | 46.3% | $0.040 | 65.4% |
| single_best | 46.2% | n/a | 25.7% (95% CI 21.0%–31.0%) | 20.0% | 0.3% (95% CI 0.1%–1.9%) | 29.7% | 23.3% | $0.008 | 76.7% |
| weighted_avg | 48.8% | n/a | 28.8% (95% CI 23.9%–34.2%) | 91.1% | 24.7% (95% CI 20.1%–29.9%) | 38.0% | 0.0% | $0.040 | 65.4% |
| cheapest | 1.3% | n/a | 1.7% (95% CI 0.7%–3.9%) | 85.6% | 54.8% (95% CI 49.1%–60.4%) | 21.2% | 46.3% | $0.038 | 67.9% |

Latency (Skein's wall time; the baselines reuse the same runs): p50 4806 ms, p95 6395 ms.

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
Intervals are 95% Wilson score intervals on the counts behind each rate.
