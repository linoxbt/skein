# Changelog

## 0.3.1

- Depends on `@skeinlabs/sdk` ^0.3.1: the Telegraph rail asks Skein's miner
  (845301) on `FRAUD_RISK_GENERAL`, signs the node's current 402, and refuses
  answers about another token or from another miner.
- `SKEIN_INTENT` and `SKEIN_MINER_ID` configure the Telegraph rail.
- `SKEIN_MAX_USDC_PER_CALL`, `SKEIN_SESSION_CAP_USDC` and the deprecated
  `SKEIN_DAILY_CAP_USDC` (an alias: the cap is per process) must be positive
  numbers; the server exits with a message otherwise, as it does for a
  malformed or mainnet `TELEGRAPH_CHAIN_ID` (`TELEGRAPH_ALLOW_MAINNET=1` to pay
  on mainnet on purpose).
- Cost accounting: a Telegraph ask counts at what it cost, cached verdict or
  not; a paid failure counts too. `SKEIN_API_KEY_BILLING=free` stops a
  partner-key verdict counting at list price against the session cap.
- The server reports its package version; the policies tool no longer cites a
  stale policy version.
