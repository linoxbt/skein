# Skein benchmark


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Prospective

Prospective: each verdict was bought before the outcome was known, and the label comes from what happened afterwards. This is the point-in-time measure.

679 of 679 cases have a run (good 0, bad 301, ambiguous 378). 

**No case in this set is labelled good**, so a low false-APPROVE rate cannot be told apart from never approving: read it next to the APPROVE column.

| System | APPROVE (all) | APPROVE on good | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | Coverage |
|---|---|---|---|---|---|---|---|---|---|
| skein | 0.6% | n/a | 0.7% (95% CI 0.2%–2.4%) | 85.0% | 54.5% (95% CI 48.8%–60.0%) | 29.2% | 41.8% | $0.041 | 69.1% |
| single_best | 51.5% | n/a | 26.6% (95% CI 21.9%–31.8%) | 16.7% | 0.3% (95% CI 0.1%–1.9%) | 27.0% | 20.6% | $0.008 | 79.4% |
| weighted_avg | 44.6% | n/a | 28.9% (95% CI 24.1%–34.3%) | 91.6% | 25.2% (95% CI 20.7%–30.4%) | 43.2% | 0.0% | $0.041 | 69.1% |
| cheapest | 1.2% | n/a | 1.7% (95% CI 0.7%–3.8%) | 85.0% | 54.5% (95% CI 48.8%–60.0%) | 28.6% | 41.8% | $0.039 | 71.3% |

Latency (Skein's wall time; the baselines reuse the same runs): p50 4899 ms, p95 6606 ms.

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
Intervals are 95% Wilson score intervals on the counts behind each rate.
