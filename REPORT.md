# Skein benchmark


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Prospective

Prospective: each verdict was bought before the outcome was known, and the label comes from what happened afterwards. This is the point-in-time measure.

160 of 160 cases have a run (good 0, bad 76, ambiguous 84). 

**No case in this set is labelled good**, so a low false-APPROVE rate cannot be told apart from never approving: read it next to the APPROVE column.

| System | APPROVE (all) | APPROVE on good | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | Coverage |
|---|---|---|---|---|---|---|---|---|---|
| skein | 0.0% | n/a | 0.0% (95% CI 0.0%–4.8%) | 82.6% | 25.0% (95% CI 16.6%–35.8%) | 51.9% | 33.8% | $0.037 | 58.2% |
| single_best | 48.1% | n/a | 23.7% (95% CI 15.5%–34.4%) | 33.3% | 1.3% (95% CI 0.2%–7.1%) | 16.9% | 33.1% | $0.007 | 66.9% |
| weighted_avg | 54.4% | n/a | 38.2% (95% CI 28.1%–49.4%) | 84.0% | 27.6% (95% CI 18.8%–38.6%) | 30.0% | 0.0% | $0.037 | 58.2% |
| cheapest | 2.5% | n/a | 3.9% (95% CI 1.4%–11.0%) | 82.6% | 25.0% (95% CI 16.6%–35.8%) | 49.4% | 33.8% | $0.030 | 67.8% |

Latency (Skein's wall time; the baselines reuse the same runs): p50 4892 ms, p95 5854 ms.

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
Intervals are 95% Wilson score intervals on the counts behind each rate.
