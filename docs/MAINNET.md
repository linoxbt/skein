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
5. **Payments in.** Charging partners on the direct API (x402 on `/v1/verdicts`)
   is not built; until it is, the direct API is partner-key only and revenue
   comes through Telegraph.
6. **Database.** A non-owner role for the API with INSERT and SELECT only on
   the evidence tables, and backups with point-in-time restore.
7. **Policies.** Freeze the tuned thresholds as a new policy version
   (`pnpm policies:lock`) before the first mainnet verdict.
