# Skein benchmark


The two bases are never pooled: they answer different questions (docs/DECISIONS.md L26).

## Prospective

Prospective: each verdict was bought before the outcome was known, and the label comes from what happened afterwards. This is the point-in-time measure.

560 of 560 cases have a run (good 0, bad 252, ambiguous 308). 

**No case in this set is labelled good**, so a low false-APPROVE rate cannot be told apart from never approving: read it next to the APPROVE column.

| System | APPROVE (all) | APPROVE on good | False APPROVE on bad | REJECT precision | REJECT recall | ESCALATE | ABSTAIN | Cost / verdict | Coverage |
|---|---|---|---|---|---|---|---|---|---|
| skein | 0.7% | n/a | 0.8% (95% CI 0.2%–2.8%) | 82.5% | 50.4% (95% CI 44.3%–56.5%) | 22.5% | 49.3% | $0.039 | 63.2% |
| single_best | 48.2% | n/a | 27.0% (95% CI 21.9%–32.8%) | 20.0% | 0.4% (95% CI 0.1%–2.2%) | 25.9% | 25.0% | $0.008 | 75.0% |
| weighted_avg | 52.1% | n/a | 32.9% (95% CI 27.4%–39.0%) | 85.7% | 16.7% (95% CI 12.6%–21.8%) | 39.1% | 0.0% | $0.039 | 63.2% |
| cheapest | 1.4% | n/a | 2.0% (95% CI 0.9%–4.6%) | 82.5% | 50.4% (95% CI 44.3%–56.5%) | 21.8% | 49.3% | $0.037 | 66.0% |

Latency (Skein's wall time; the baselines reuse the same runs): p50 4761 ms, p95 6243 ms.

Baselines reuse Skein's paid findings (no extra spend). The direct-API baseline needs its own data source and is not in this table.
Intervals are 95% Wilson score intervals on the counts behind each rate.
