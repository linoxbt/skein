# Listing gate

Check tokens with Skein before they go live. Each token gets a decision
straight from its verdict, with spend capped per verdict and per run, and
every verdict re-verified from the raw answers Skein paid for.

| Verdict | Decision |
|---|---|
| APPROVE | `list` |
| REJECT | `block` |
| ESCALATE | `review` (a human looks) |
| ABSTAIN | `retry` (not enough evidence; charged at upstream cost only) |

This is the example the [Skein tutorial](https://skeinlabs.site/tutorial) builds step by step.

```sh
npm install
SKEIN_API_KEY=sk_part_… npm run gate -- base:0x4200000000000000000000000000000000000006 ethereum:0xdAC17F958D2ee523a2206206994597C13D831ec7
```

Writes `decisions.json` and fails closed, so a CI job or a listing pipeline
can stop on it: exit 0 only when every token gets `list`, 1 when any token is
blocked, 2 when any token got anything else (`review`, `retry`, `refused`,
`error`; Skein being unreachable is not a pass). `--allow review,retry` also
passes on those decisions; `block` never passes.

| Variable | Default | |
|---|---|---|
| `SKEIN_API_KEY` | | A partner key ([request one](https://github.com/linoxbt/skein/issues/new?template=partner-key.yml)) |
| `SKEIN_PAYER_KEY` | | Instead: a funded Telegraph burner; pays per verdict from escrow |
| `SKEIN_INTENT` / `SKEIN_MINER_ID` | `FRAUD_RISK_GENERAL` / `845301` | With `SKEIN_PAYER_KEY`: the intent and Skein's miner; an answer from another miner, or about another token, is refused |
| `SKEIN_POLICY` | `dex-list@0.2.0` | Pin the policy version you reviewed |
| `SKEIN_MAX_USDC_PER_CALL` | `0.30` | No verdict is bought above this |
| `SKEIN_RUN_CAP_USDC` | `2` | What one run may spend |
| `SKEIN_API_URL` | `https://api.skeinlabs.site` | |
