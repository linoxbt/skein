# Skein benchmark


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Prospective

Prospective: each verdict was bought before the outcome was known, and the label comes from what happened afterwards. This is the point-in-time measure.

240 of 240 cases have a run (good 0, bad 119, ambiguous 121). 

**No case in this set is labelled good**, so a low false-APPROVE rate cannot be told apart from never approving: read it next to the APPROVE column.

| System | APPROVE (all) | APPROVE on good | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | Coverage |
|---|---|---|---|---|---|---|---|---|---|
| skein | 0.0% | n/a | 0.0% (95% CI 0.0%–3.1%) | 71.8% | 42.9% (95% CI 34.3%–51.8%) | 34.6% | 35.8% | $0.041 | 64.9% |
| single_best | 49.6% | n/a | 32.8% (95% CI 25.0%–41.6%) | 33.3% | 0.8% (95% CI 0.1%–4.6%) | 26.7% | 22.5% | $0.008 | 77.5% |
| weighted_avg | 44.2% | n/a | 26.1% (95% CI 19.0%–34.6%) | 85.3% | 24.4% (95% CI 17.5%–32.8%) | 41.7% | 0.0% | $0.041 | 64.9% |
| cheapest | 1.7% | n/a | 2.5% (95% CI 0.9%–7.2%) | 71.8% | 42.9% (95% CI 34.3%–51.8%) | 32.9% | 35.8% | $0.036 | 71.3% |

Latency (Skein's wall time; the baselines reuse the same runs): p50 4891 ms, p95 5993 ms.

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
Intervals are 95% Wilson score intervals on the counts behind each rate.
