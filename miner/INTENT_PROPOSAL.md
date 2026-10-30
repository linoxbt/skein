# Intent proposal: FRAUD_RISK_TOKEN_LISTING

Draft for `proposeIntent(...)` (Plan A). It is written in the style of the live
intent descriptions, which give a positive example and a "Not:" example that
names the neighbouring intent.

`FRAUD_RISK` is a judgment prefix, so the name is valid and the spec argument
is empty: `(0,0,0,[],"","","","","")`. A proposal posts a $1 bond in MACHINA
(read `intentProposalParams()`), released on approval, rejection or withdrawal.
After approval the intent still needs a request and response format, or answers
come back raw and on-chain jobs fail; the tables below are what to ask for.

## Description

Query asks whether a specific EVM token contract is fit to be listed (on an
exchange, a DEX token list, a launchpad or a wallet) under a named listing
policy, and what blocks approval. Example: "Is 0x6982…1933 on Ethereum fit to
list under cex-standard?" → FRAUD_RISK_TOKEN_LISTING. Not: "Is this payment or
IP address fraudulent?" (entity or payment fraud) → FRAUD_RISK_GENERAL. Not: "Is
this contract a honeypot?" (one contract check) → SMART_CONTRACT_AUDIT_GENERAL.
Not: "What will this token's price be?" (no price prediction or trading signals).

## Request

| Param | Type | Required | Description |
|---|---|---|---|
| token | string | yes | ERC-20 contract address, 0x-prefixed |
| chain | string | yes | One of ethereum, base, bsc, arbitrum |
| policy | string | no | Policy id and version, e.g. `cex-standard@1.0.0`; defaults to the latest cex-standard |

## Response

| Field | Type | On-chain slot | Notes |
|---|---|---|---|
| verdict | enum ABSTAIN, APPROVE, ESCALATE, REJECT | — | scored label |
| verdict_code | integer | integers[0] | 0 ABSTAIN, 1 APPROVE, 2 ESCALATE, 3 REJECT (zero is never APPROVE) |
| risk_bps | integer, 0–10000 | integers[1] | weighted risk |
| confidence_bps | integer, 0–10000 | integers[2] | |
| bom_root | string (32-byte hex) | strings[0] | Merkle root of the paid inputs' receipt hashes |
| reasons | list | off-chain | machine reason codes |
| summary | string | off-chain | one templated sentence |

## Plan B (if not approved by Nov 8)

`FRAUD_RISK_GENERAL` exists (11 miners on 2026-10-30, all IP/URL/payment-fraud
feeds). Its request is `subject` (string) and its on-chain response is one enum,
`risk_level` ∈ LOW, MEDIUM, HIGH, CRITICAL. Registering there means mapping the
verdict to a risk level (APPROVE → LOW, ESCALATE/ABSTAIN → MEDIUM, REJECT → HIGH,
blocker REJECT → CRITICAL) and putting the full verdict off-chain. Skein never buys
from the FRAUD_RISK family either way (see the planner's self-routing guard).
