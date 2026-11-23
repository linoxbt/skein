# Skein benchmark


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Prospective

Prospective: each verdict was bought before the outcome was known, and the label comes from what happened afterwards. This is the point-in-time measure.

520 of 520 cases have a run (good 0, bad 233, ambiguous 287). 

**No case in this set is labelled good**, so a low false-APPROVE rate cannot be told apart from never approving: read it next to the APPROVE column.

| System | APPROVE (all) | APPROVE on good | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | Coverage |
|---|---|---|---|---|---|---|---|---|---|
| skein | 0.2% | n/a | 0.0% (95% CI 0.0%–1.6%) | 80.3% | 47.2% (95% CI 40.9%–53.6%) | 21.0% | 52.5% | $0.038 | 60.8% |
| single_best | 47.5% | n/a | 28.3% (95% CI 22.9%–34.4%) | 20.0% | 0.4% (95% CI 0.1%–2.4%) | 24.6% | 26.9% | $0.008 | 73.1% |
| weighted_avg | 55.2% | n/a | 34.8% (95% CI 28.9%–41.1%) | 82.1% | 13.7% (95% CI 9.9%–18.7%) | 37.3% | 0.0% | $0.038 | 60.8% |
| cheapest | 1.0% | n/a | 1.3% (95% CI 0.4%–3.7%) | 80.3% | 47.2% (95% CI 40.9%–53.6%) | 20.2% | 52.5% | $0.036 | 63.7% |

Latency (Skein's wall time; the baselines reuse the same runs): p50 4669 ms, p95 6110 ms.

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
Intervals are 95% Wilson score intervals on the counts behind each rate.
