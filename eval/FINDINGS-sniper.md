# Skein Sniper: what the paid checks can and cannot tell on fresh launches

Data: every answered (non-ABSTAIN) Skein Sniper verdict up to 2026-11-11, 106
launches on Base, aged 5 minutes to 6 hours when checked. Each is joined to
the token's price change from the check to the time of capture
(`eval/sniper/backtest-2026-11-11.json`). "To zero" means a fall of 90% or
more.

Replay it with `pnpm --filter @skein/eval exec tsx src/sniper-backtest.ts`.

## What separates rugs

| Signal at check time | Launches | Went to zero |
|---|---|---|
| Contract audit PASS | 69 | 8 (12%) |
| Contract audit WARN (mintable, pausable, unreported tax) | 23 | 22 |
| Contract audit ERROR | 11 | 11 |
| Wash trading WARN (high risk) | 5 | 5 |
| Wash trading UNKNOWN (no transfers yet) | 100 | 36 |

The contract audit is the strong signal. Holder count and liquidity are not.
Of the launches that passed audit, liquidity ($50k to $140k) and holders (163
to 510), most went to zero: the liquidity was pulled. None of the checks Skein
can buy see that coming on a launch a few hours old. The launches that held
their price were mostly ones with no trades at all, which is no market rather
than a good buy.

## Policies, replayed with engine 0.3.0

| Policy | APPROVE | REJECT | ESCALATE | ABSTAIN |
|---|---|---|---|---|
| `agent-pretrade@0.2.0` | 4, all fell by half or more | 23 (20 to zero) | 79 | 0 |
| `agent-pretrade@0.3.0` | 0 | 36 (34 to zero) | 0 | 70 |

Under engine 0.2.0, the four approvals above were ESCALATE. They were held back
only because the optional wash-trading check came back UNKNOWN, which lowered
coverage. Engine 0.3.0 makes optional misses neutral, so that same rule set
would have bought four rugs.

`agent-pretrade@0.3.0` puts both lessons into the rules explicitly:
- **An audit WARN is a hard blocker** (22 of 23 went to zero).
- **Wash trading is required.** A launch with no trades yet abstains. With
  no market, there is no way to judge exit risk, and audit, liquidity and
  holders alone did not separate rugs from the rest.

## What this does not show

- **The sample is in-sample.** These 106 launches were used to choose the
  rules, so the table above is not a forecast. The prospective benchmark
  (each launch labelled 72 hours after its verdict, published daily to the
  `data/prospective` branch) is the out-of-sample test.
- **The sniper still does not approve.** The finding is that the
  intelligence on Telegraph today does not support approving fresh launches.
  An APPROVE would need a signal for liquidity locks or LP ownership, which
  no Telegraph intent offers yet. Inventing approvals would mean buying rugs.
- **Price change is a rough label.** A token that never traded shows about
  0% and counts as not rugged.
