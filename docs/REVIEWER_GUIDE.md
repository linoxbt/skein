# Reviewer guide

The five acceptance steps (spec section 17), with what to expect at each. All
links are live; every page labels the network it reads.

| | |
|---|---|
| Web app | https://skein-web.netlify.app |
| API | https://api-production-9396.up.railway.app |
| Skein Desk (Apps & Agents) | https://skein-desk.netlify.app |
| Source | https://github.com/linoxbt/skein (branch `ccr-4e0a77db-k2xyoy`) |

## 1. New input

Open **/console**, paste the partner key you were given (it stays in that
tab), paste any EVM token address on Ethereum, Base, BNB or Arbitrum, and run.
The Exploded View draws each paid check as it lands: miner, price, receipt.

Without a key: `GET /v1/quote?chain=8453&token=0x…` shows what a verdict
would buy and cost, free.

## 2. Check the result

The verdict page (**/v/{id}**) gives the verdict, its reasons, the risks still
open, risk and confidence in basis points, coverage, and the cost. Compare it
with the token's public reputation.

## 3. Inspect the Telegraph evidence

The **Evidence** tab lists every upstream attempt: miner, amount, receipt hash,
signal hash and whether the node knows that signal. **/verify** recomputes the
verdict from the raw answers Skein paid for and reports each step, including
whether the BOM's receipts are exactly the purchases' receipts and whether the
served verdict matches its own hash. **/ledger** shows totals and, once
registered, the miner's registration ID and status.

## 4. Test a failure

| Input | Expected |
|---|---|
| A non-contract or bad-checksum address | 400 `INVALID_SUBJECT` before any spend |
| `budgetUsdcMax` below the quote | 422 `BUDGET_TOO_LOW` before any spend |
| Policy `cex-standard` | 503 `UPSTREAM_UNAVAILABLE`: no live intent supplies holder concentration |
| The same Idempotency-Key twice | the original verdict back, `replayed: true`, not charged |
| A required check that times out | ABSTAIN naming it; charged at upstream cost only |

Locally (no accounts, simulated): `pnpm dev:api`, then a token ending in `c`
shows the market-integrity conflict (ESCALATE), and a deployer ending in `e`
makes the sanctions miner hang (ABSTAIN).

## 5. Reproduce

```sh
pnpm install
pnpm repro eval/verdicts        # every stored verdict replays to the same hash
pnpm test                       # 230+ tests: engine, client, pipeline, API, SDK, MCP, Desk
pnpm --filter @skein/e2e e2e    # the console flow, verify and axe checks in a browser
```

For a verdict served by the API: `POST /v1/verify {"id":"vrd_…"}`.

## What is real and what is not (yet)

- Tokens analysed are on mainnets; payment and registration are on the
  Telegraph testnet (Sepolia, test USDC).
- Simulated runs (local dev, tests, `eval/verdicts/`) say so on every screen
  and in every stored record. They are never evidence.
- The miner registers on `FRAUD_RISK_GENERAL` (plan B) unless
  `FRAUD_RISK_TOKEN_LISTING` becomes canonical first.
