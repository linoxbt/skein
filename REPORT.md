# Skein benchmark


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Prospective

Prospective: each verdict was bought before the outcome was known, and the label comes from what happened afterwards. This is the point-in-time measure.

120 of 120 cases have a run (good 0, bad 56, ambiguous 64). 

**No case in this set is labelled good**, so a low false-APPROVE rate cannot be told apart from never approving: read it next to the APPROVE column.

| System | APPROVE (all) | APPROVE on good | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | Coverage |
|---|---|---|---|---|---|---|---|---|---|
| skein | 0.0% | n/a | 0.0% (95% CI 0.0%–6.4%) | 82.6% | 33.9% (95% CI 22.9%–47.0%) | 69.2% | 11.7% | $0.050 | 77.5% |
| single_best | 64.2% | n/a | 32.1% (95% CI 21.4%–45.2%) | 33.3% | 1.8% (95% CI 0.3%–9.4%) | 22.5% | 10.8% | $0.010 | 89.2% |
| weighted_avg | 39.2% | n/a | 16.1% (95% CI 8.7%–27.8%) | 84.0% | 37.5% (95% CI 26.0%–50.6%) | 40.0% | 0.0% | $0.050 | 77.5% |
| cheapest | 3.3% | n/a | 5.4% (95% CI 1.8%–14.6%) | 82.6% | 33.9% (95% CI 22.9%–47.0%) | 65.8% | 11.7% | $0.040 | 90.3% |

Latency (Skein's wall time; the baselines reuse the same runs): p50 5073 ms, p95 5951 ms.

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
Intervals are 95% Wilson score intervals on the counts behind each rate.
