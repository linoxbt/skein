# Changelog

## 0.3.1

The Telegraph rail works again, and is bound to the request.

- **Telegraph defaults.** `SKEIN_INTENT` is `FRAUD_RISK_GENERAL`, the canonical
  intent Skein's miner is registered on (0.3.0 asked the non-canonical
  `FRAUD_RISK_TOKEN_LISTING`). Asks are pinned to Skein's miner,
  `SKEIN_MINER_ID` (845301), unless `minerId` names another or `routed: true`.
  Params follow the miner's YAML: `subject` as `"base:0x…"` (`eip155:<id>:0x…`
  for a chain with no name) and `policy`.
- **Answers bound to the request.** A paid answer is used only from a miner in
  `expectedMinerIds` (default `SKEIN_MINER_IDS`: 845301 and its registration id
  5137), checked on the response and the receipt, and only when the verdict's
  subject (chain and token) and policy match the request. Otherwise
  `TelegraphMismatchError` (`TELEGRAPH_MISMATCH`).
- **What a failure cost.** Every failure after a paid ask (no verdict id, the
  verdict could not be read or waited for, a mismatch) is a `SkeinError` whose
  `payment` is `{ amountUsdc, billing: "paid" | "unknown", receiptHash, minerId }`.
  `payment` is the one documented name.
- **Context.** The Telegraph rail carries no context (Skein's miner endpoint
  takes a subject and a policy). It is left out and named in
  `payment.contextDropped`; `strictContext: true` refuses before paying.
- **One deadline per ask.** The Telegraph client gets `deadline`
  (`Date.now() + timeoutMs`) for the whole ask.
- **The node's multi-chain 402.** The bundled Telegraph client signs the
  escrow challenge the node has sent since 2026-11-11, which also offers
  `exact` payments on other chains (0.3.0 on npm refused every such challenge).
- **Telegraph network settings are checked.** `networkFromEnv` (from
  `@skeinlabs/sdk/telegraph`) now throws on a malformed `TELEGRAPH_CHAIN_ID`,
  and on a mainnet chain id unless `TELEGRAPH_ALLOW_MAINNET=1`. A post-payment
  402 is reported with `billing: "unknown"` (the node may have billed it).
- **x402.** New payer `{ kind: "x402", account, network, payTo, asset?, maxUsdc? }`
  pays the direct API per verdict with an EIP-3009 authorization, checked
  against the pinned network, payTo, asset and price cap before signing, and
  resent unchanged on every retry. `new Skein({ payer: x402 })` is a
  `Skein<"x402">`; a plain `Skein` keeps the `apiKey | telegraph` payment type.
- **Webhooks.** `verifyWebhook(rawBody, headers, secret)` checks
  `X-Skein-Timestamp` and the HMAC of `${timestamp}.${body}`, with a 5-minute
  window. The old body-only signature is accepted only with
  `{ allowLegacyBodyOnly: true }`. Event name: `verdict.completed`.
- **Retries.** A 503 from a replica that is restarting is retried
  (`UPSTREAM_UNAVAILABLE` with a restarting message, or `RESTARTING`).
- **Types.** `cost.pricingRule`, `policy.sha256`, `servedFrom`, the
  `VerifyReport` checks and `signals`, `Skein.rail`.
- **Packaging.** `main`, `types` and `typesVersions` for plain npm consumers
  and TypeScript `moduleResolution: node`; publishing refuses any client but
  pnpm.
