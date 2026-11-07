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
3. **Buy one verdict.** One paid Skein verdict per token, under one
   idempotency key, so a restart never pays twice. At most
   `SNIPER_DAILY_CHECKS` verdicts a day.
4. **Act.** APPROVE opens a **paper** position of `SNIPER_TICKET_USD` at the
   market price. REJECT, ESCALATE and ABSTAIN skip, with Skein's reasons.
5. **Keep score.** Every checked token is re-priced for 72 hours, so the
   dashboard shows what the skipped tokens did next, and what the paper book made.
6. **Check the proof.** Each verdict's EIP-191 signature is checked against
   Skein's published attester (`@skeinlabs/sdk/attest`).

## Run it

```sh
pnpm install
SNIPER_SKEIN_KEY=sk_part_… pnpm --filter @skein/sniper dev    # dashboard on :8080
```

| Variable | Default | |
|---|---|---|
| `SNIPER_SKEIN_KEY` | | A Skein partner key, or: |
| `SNIPER_PAYER_KEY` | | a funded Telegraph burner. Each verdict is then one paid Telegraph ask to Skein's miner |
| `SNIPER_MINER_ID`, `SNIPER_INTENT` | `FRAUD_RISK_GENERAL` | Pin Skein's miner on Telegraph |
| `SNIPER_POLICY` | `agent-pretrade@0.2.0` | |
| `SNIPER_MIN_LIQUIDITY_USD` | `10000` | Liquidity a token needs before it is worth a verdict |
| `SNIPER_MIN_AGE_MIN` / `SNIPER_MAX_AGE_MIN` | `5` / `360` | When to start looking, and when to give up |
| `SNIPER_DAILY_CHECKS` | `40` | Paid verdicts per UTC day |
| `SNIPER_TICKET_USD` | `100` | Paper position size |
| `DATABASE_URL` | memory | Postgres: a `sniper_tokens` table of its own |
| `BASE_RPC_URL` | `https://base-rpc.publicnode.com` | |
| `SKEIN_ATTESTER` | read from `/v1/status` | Pin Skein's signer |

`GET /` is the live dashboard, and `GET /feed.json` serves the same data as JSON.

**Honest labels:** trades are paper, and verdicts are bought live. Payments run
on the Telegraph testnet; the tokens are real Base mainnet launches. Risk
evidence, not investment advice.
