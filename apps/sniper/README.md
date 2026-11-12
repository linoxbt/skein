# Skein Sniper (Mission 14: Web3 Native & DeFi)

A rug-proof launch sniper for Base. It watches every new token pool as it is
created (Uniswap v2, v3 and v4, Aerodrome), and before it would buy a token,
it buys a **Skein verdict** for it: contract audit, sanctions, liquidity,
holders and wash trading, each bought from a ranked miner through Telegraph and
fused under the `agent-pretrade` policy. **No APPROVE, no trade.**

This is the Mission 14 example build: "five honeypots dodged, execution on the
sixth", with a spend panel showing the exact cost of the execution insurance.

## How it decides

1. **Watch.** Polls the four factories' pool-creation events on Base
   (`eth_getLogs`, public RPC). The new token is the side that isn't ETH, WETH or USDC.
2. **Wait for a market.** Every launch is free to watch. Once it is at least
   `SNIPER_MIN_AGE_MIN` old, the sniper looks it up on DEX Screener (free).
   A token is only worth a paid verdict once it has `SNIPER_MIN_LIQUIDITY_USD`
   of liquidity to trade against. A token that never gets there expires
   without costing anything.
3. **Buy one verdict.** One paid Skein verdict per token. Each check is
   claimed atomically (across replicas) against two daily caps:
   `SNIPER_DAILY_CHECKS` checks, failed and in-flight ones included, and
   `SNIPER_DAILY_USDC` of spend, paid failures included and each Telegraph check
   in flight reserving `SNIPER_MAX_USDC_PER_CALL`. A check a restart cut off is
   recovered once stale: requeued on a partner key (its idempotency key returns
   the original verdict uncharged), never re-asked on Telegraph (counted as paid).
4. **Act.** Only an APPROVE whose Skein signature verifies against the pinned
   attester, and which is about this token on Base under the sniper's policy,
   opens a **paper** position of `SNIPER_TICKET_USD` at the market price.
   Anything else skips, with Skein's reasons.
5. **Keep score.** Every checked token is re-priced for 72 hours, so the
   dashboard shows what the skipped tokens did next, and what the paper book made.
6. **Check the proof.** Each verdict's EIP-191 signature is checked against
   Skein's attester (`@skeinlabs/sdk/attest`). The sniper does not start
   without one: `SKEIN_ATTESTER`, or read from `/v1/status` with retries.

## Run it

```sh
pnpm install
SNIPER_SKEIN_KEY=sk_part_… pnpm --filter @skein/sniper dev    # dashboard on :8080
```

| Variable | Default | |
|---|---|---|
| `SNIPER_SKEIN_KEY` | | A Skein partner key, or: |
| `SNIPER_PAYER_KEY` | | a funded Telegraph burner. Each verdict is then one paid Telegraph ask to Skein's miner |
| `SNIPER_MINER_ID`, `SNIPER_INTENT` | `845301`, `FRAUD_RISK_GENERAL` | Skein's miner on Telegraph (pinned) |
| `SNIPER_POLICY` | `agent-pretrade@0.3.0` | |
| `SNIPER_MIN_LIQUIDITY_USD` | `50000` | Liquidity a token needs before it is worth a verdict; raised to the policy's `liquidity_depth` FAIL threshold if lower (a token under it is a guaranteed REJECT) |
| `SNIPER_MIN_AGE_MIN` / `SNIPER_MAX_AGE_MIN` | `5` / `360` | When to start looking, and when to give up |
| `SNIPER_DAILY_CHECKS` | `40` | Checks per UTC day, failed and in-flight ones included |
| `SNIPER_DAILY_USDC` | `12` | USDC per UTC day: paid (failures included) plus `SNIPER_MAX_USDC_PER_CALL` per Telegraph check in flight |
| `SNIPER_MAX_USDC_PER_CALL` | `0.30` | The most one verdict may cost |
| `SNIPER_TICKET_USD` | `100` | Paper position size |
| `DATABASE_URL` | memory | Postgres: a `sniper_tokens` table of its own |
| `BASE_RPC_URL` | `https://base-rpc.publicnode.com` | |
| `SKEIN_ATTESTER` | read from `/v1/status` | Pin Skein's signer (recommended). Without it and without a readable `/v1/status`, the sniper refuses to start |

`GET /` is the live dashboard, and `GET /feed.json` serves the same data as JSON
(tallied in SQL, built at most every 10 s, 60 reads a minute per address).

**Honest labels:** trades are paper, and verdicts are bought live. Payments run
on the Telegraph testnet; the tokens are real Base mainnet launches. Risk
evidence, not investment advice.
