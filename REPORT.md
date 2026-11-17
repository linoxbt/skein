# Skein benchmark


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Prospective

Prospective: each verdict was bought before the outcome was known, and the label comes from what happened afterwards. This is the point-in-time measure.

280 of 280 cases have a run (good 0, bad 134, ambiguous 146). 

**No case in this set is labelled good**, so a low false-APPROVE rate cannot be told apart from never approving: read it next to the APPROVE column.

| System | APPROVE (all) | APPROVE on good | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | Coverage |
|---|---|---|---|---|---|---|---|---|---|
| skein | 0.0% | n/a | 0.0% (95% CI 0.0%–2.8%) | 74.7% | 44.0% (95% CI 35.9%–52.5%) | 29.6% | 42.1% | $0.042 | 66.1% |
| single_best | 53.9% | n/a | 34.3% (95% CI 26.8%–42.7%) | 33.3% | 0.7% (95% CI 0.1%–4.1%) | 25.7% | 19.3% | $0.009 | 80.7% |
| weighted_avg | 49.3% | n/a | 28.4% (95% CI 21.4%–36.5%) | 85.3% | 21.6% (95% CI 15.5%–29.4%) | 38.6% | 0.0% | $0.042 | 66.1% |
| cheapest | 1.4% | n/a | 2.2% (95% CI 0.8%–6.4%) | 74.7% | 44.0% (95% CI 35.9%–52.5%) | 28.2% | 42.1% | $0.038 | 71.6% |

Latency (Skein's wall time; the baselines reuse the same runs): p50 4853 ms, p95 5951 ms.

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
Intervals are 95% Wilson score intervals on the counts behind each rate.
