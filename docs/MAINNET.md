# Mainnet

Skein runs on the Telegraph testnet. Moving to mainnet changes configuration,
not code, plus the steps below.

1. **Network.** Set every `TELEGRAPH_*` variable and `RPC_URL` from the
   mainnet Addresses page and confirm them against a live 402 challenge (the
   client refuses a challenge that disagrees).
2. **Wallets.** A new burner purchaser key with a small escrow deposit
   (`miner/tools.ts deposit`), a cold registration key, and a fee address.
   Never reuse testnet keys.
3. **Caps.** Lower `DAILY_CAP_USDC`, `PER_VERDICT_CAP_USDC` and
   `MAX_USDC_PER_CALL` to what real money justifies, and set
   `HOT_WALLET_ALERT_USDC`.
4. **Registration.** Buy and set the domain first (`base_url` is fixed at
   registration), host the YAML at a stable HTTPS URL, then
   `miner/tools.ts register` and record the registration ID in
   `SKEIN_SELF_REGISTRATION_IDS`.
5. **Payments in.** x402 on `/v1/verdicts` is built (L30). For mainnet set
   `X402_NETWORK=base`, `X402_PAY_TO` to a wallet you control, and
   `X402_FACILITATOR_URL` to a facilitator that settles on Base mainnet (the
   public x402.org facilitator is for testnets). Check the price
   (`X402_PRICE_USDC`) against upstream cost and `X402_DAILY_CAP_USDC`.
6. **Database.** Done: the API queries as `skein_app`, insert-only on the
   evidence tables (RUNBOOK, "Database roles"). Still to do: move migrations
   to a separate pre-deploy step, so the runtime process never holds the
   owner's credentials. Add point-in-time restore on top of the nightly dumps.
7. **Policies.** Freeze the tuned thresholds as a new policy version
   (`pnpm policies:lock`) before the first mainnet verdict.
