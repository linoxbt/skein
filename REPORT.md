# Skein benchmark


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Prospective

Prospective: each verdict was bought before the outcome was known, and the label comes from what happened afterwards. This is the point-in-time measure.

639 of 639 cases have a run (good 0, bad 294, ambiguous 345). 

**No case in this set is labelled good**, so a low false-APPROVE rate cannot be told apart from never approving: read it next to the APPROVE column.

| System | APPROVE (all) | APPROVE on good | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | Coverage |
|---|---|---|---|---|---|---|---|---|---|
| skein | 0.6% | n/a | 0.7% (95% CI 0.2%–2.4%) | 85.6% | 54.8% (95% CI 49.0%–60.4%) | 26.1% | 43.8% | $0.040 | 67.4% |
| single_best | 49.3% | n/a | 25.9% (95% CI 21.2%–31.1%) | 20.0% | 0.3% (95% CI 0.1%–1.9%) | 28.0% | 21.9% | $0.008 | 78.1% |
| weighted_avg | 46.8% | n/a | 28.6% (95% CI 23.7%–34.0%) | 91.3% | 24.8% (95% CI 20.2%–30.1%) | 40.7% | 0.0% | $0.040 | 67.4% |
| cheapest | 1.3% | n/a | 1.7% (95% CI 0.7%–3.9%) | 85.6% | 54.8% (95% CI 49.0%–60.4%) | 25.5% | 43.8% | $0.038 | 69.8% |

Latency (Skein's wall time; the baselines reuse the same runs): p50 4843 ms, p95 6383 ms.

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
Intervals are 95% Wilson score intervals on the counts behind each rate.
