# Telegraph Season II submission: Skein

Every field the submission asks for (rules, section 08), ready to paste.
Deadline: **December 1, 2026, 23:59 UTC**.

## Project details

| Field | Answer |
|---|---|
| Project name | Skein |
| Track | Apps & Agents (Skein is also a registered miner) |
| Missions | Mission 01 Exchange (listing decisions, signed risk memo); Mission 14 Web3 Native & DeFi (Skein Sniper) |
| Intents bought | SMART_CONTRACT_AUDIT_GENERAL, SANCTIONS_SCREENING_MATCH_GENERAL, TOKEN_HOLDER_COUNT_GENERAL, LIQUIDITY_DEPTH_VERIFY_GENERAL, WASH_TRADING_DETECTION_GENERAL, SOCIAL_BOT_DETECTION_GENERAL, CODE_REVIEW_GENERAL |
| Intent sold | FRAUD_RISK_GENERAL: miner registration 5137, catalogue id 845301, slug `skein-listing-verdict`, 0.25 USDC an answer |
| Working link | https://skeinlabs.site (web app), https://desk.skeinlabs.site (listing desk agent), https://api.skeinlabs.site (API) |
| Repository | https://github.com/linoxbt/skein |
| GitHub username that starred the bounties repo | `linoxbt` |
| Team / contact | *(your name and email)* |
| Demo video | https://github.com/linoxbt/skein/blob/main/docs/demo/skein-motion.mp4 (3 min 10 s, narrated; a plain 2 min 33 s screen walkthrough is at `docs/demo/skein-demo.mp4`) |

## Short public summary

Skein sells one decision: is this EVM token fit to list? Exchanges, launchpads
and trading agents ask Skein instead of stitching together five risk vendors.

To answer, Skein buys ranked intelligence from other Telegraph miners and pays
each one through the Telegraph escrow. The intelligence covers contract audit,
sanctions, holder count, liquidity depth and wash trading. Skein fuses the
answers with fixed, versioned rules and returns **APPROVE, REJECT, ESCALATE
or ABSTAIN**. Every verdict comes with:
- its reasons and the risks still open;
- risk and confidence in basis points;
- its cost, and a bill of materials holding the receipt of every purchase;
- a signature.

Anyone can recompute a verdict from the raw answers Skein paid for
(`/verify`).

Three things run on it today:
- **Skein Desk**, a listing queue for an exchange. An agent buys a verdict for
  every application and shortlists it, declines it, or sends it to an analyst,
  with no human in the loop.
- **Skein Sniper** watches new Base launches. It buys a verdict before every
  simulated trade and dodges the rest.
- **Skein as a miner** sells the verdict back to the network. Any Telegraph
  agent can buy one with a single paid ask (`/engine/v1/ask/845301`).

Try it:
- the free quote: `GET https://api.skeinlabs.site/v1/quote?chain=8453&token=0x…`;
- `npm install @skeinlabs/sdk`, or the MCP server
  (`npx -y @skeinlabs/mcp`) for Claude or Cursor;
- or pay per verdict with any x402 client, no account needed.

The tutorial is at https://skeinlabs.site/tutorial.

## How to run it

**Prerequisites.** None to try the hosted service. To build and run it
yourself: Node 22, pnpm 10, and Postgres (or none: the simulated stack uses an
in-memory database).

**Try the hosted service (testnet, Ethereum Sepolia escrow):**
```sh
# Free: what a verdict would buy and cost
curl "https://api.skeinlabs.site/v1/quote?chain=8453&token=0x4200000000000000000000000000000000000006"

# A paid verdict with a partner key (free during the hackathon)
curl -X POST https://api.skeinlabs.site/v1/verdicts \
  -H "authorization: Bearer $SKEIN_API_KEY" -H "idempotency-key: demo-1" \
  -H "content-type: application/json" \
  -d '{"subject":{"chainId":8453,"token":"0x4200000000000000000000000000000000000006"}}'
```
The answer is a verdict object: `verdict`, `reasons`, `openRisks`, `riskBps`,
`confidenceBps`, `cost`, `bom` (one receipt per purchase) and `attestation`.

**Run it locally, with no accounts:**
```sh
pnpm install
pnpm dev:api        # simulated Telegraph node and in-memory Postgres on :8080
pnpm dev:web        # web app on :3000
pnpm test           # the whole test suite
```

**Configuration.** The variables are listed in `.env.example`. The real
network needs `PURCHASER_PRIVATE_KEY`, a wallet with escrowed test USDC.

**Spending limits and costs:**
- A verdict costs 0.25 USDC. The upstream checks cost about 0.05 to 0.15 USDC.
- Hard caps:
  - per call: `MAX_USDC_PER_CALL`, 0.05;
  - per verdict: `PER_VERDICT_CAP_USDC`, 0.2;
  - per day: `DAILY_CAP_USDC`, 10, enforced atomically in Postgres;
  - per partner key, per day.
- An ABSTAIN costs an x402 caller nothing (the payment is not settled).
  Telegraph buyers pay the network's price per answer.

**Network:** Telegraph testnet, escrow on Ethereum Sepolia (`eip155:11155111`).
x402 payments use Base Sepolia.

**Known limitations:**
- Holder concentration has no live miner, so the `cex-standard` policy
  refuses with 503 and `dex-list` is the default.
- Some upstream miners time out at times. A required check that fails gives
  ABSTAIN, which says which check failed.
- The prospective benchmark (Sniper launches labelled 72 hours later) starts
  producing cases from Nov 11.

## Evidence

- **Real purchases.** 397 upstream receipts from 9 miners and 185 verdicts so
  far. The demo's own verdict, bought live during the recording, is
  https://skeinlabs.site/v/vrd_mw8c7dkh4a1d465l3u5f: APPROVE for AERO on
  Base, 5.9 s, 0.05 USDC across five receipts. Live totals are at https://skeinlabs.site/ledger and
  https://api.skeinlabs.site/v1/ledger.
- **Per-verdict receipts.** Every verdict page (`/v/{id}`) has an Evidence tab:
  miner, amount, receipt hash, signal hash, and whether the node knows that
  signal.
- **Recomputation.** https://skeinlabs.site/verify recomputes any verdict from
  the raw answers. It checks that the BOM's receipts are exactly the purchases'
  receipts, and that the served verdict matches its hash.
- **Skein sells too.** Miner 5137 is active
  (https://devnode.telegraphprotocol.com/api/miners/5137). The first paid ask
  to it was on Nov 7.
- **Benchmark.** 61 labelled cases, and a holdout of 20 tokens run once after
  the rules were frozen. Skein approved none of the 7 documented scams and
  rejected none of the 13 long-listed tokens. It abstained on 8 of the 20.
  Two simpler rules applied to the same paid findings each let one scam
  through. See `eval/FINDINGS-holdout.md`.
- **Sniper.** Live feed: https://sniper-production-bea6.up.railway.app/feed.json.
  It buys a verdict for every launch it considers, and has bought no token.
  On launches minutes old, its policy's holder floor fails almost everything,
  so its record shows the gate holding, not foresight. The prospective
  benchmark labels each launch 72 hours after its verdict and publishes daily
  to the `data/prospective` branch.
- **Service endpoints:**
  - status: https://api.skeinlabs.site/v1/status (per-intent miners, p50 and
    p95 latency, error rate, spend against caps);
  - OpenAPI: https://api.skeinlabs.site/v1/openapi.json.
- **Tests.** More than 340 automated tests: engine property tests (20,000 runs in
  CI), the payment client, the pipeline, the API (replicas, x402, idempotency),
  the SDK, MCP and Desk, plus browser and accessibility tests. All run in CI on
  every change, and Railway deploys only green builds.
- **Operations:**
  - two API replicas, querying as a least-privilege database role;
  - nightly backups;
  - a probe every 10 minutes that pushes alerts and recoveries;
  - an error log.

  It was load-tested with simulated Telegraph nodes (nothing paid): 400
  simultaneous verdicts on two API instances and real PostgreSQL, with every
  money invariant holding (`docs/LOADTEST.md`). See `docs/RUNBOOK.md`.

## Apps & Agents commercial summary

1. **Who it is for.** Exchange and launchpad listing teams, and trading agents
   that must decide fast whether a token is safe to list or touch.
2. **What it improves.** One request replaces several vendor integrations and
   hours of analyst triage. The answer is a decision with reasons and receipts,
   not a pile of scores, and it can be audited after the fact.
3. **What it does today:**
   - Live on Telegraph testnet, with seven intents bought through the escrow
     and one sold as a miner.
   - 0.25 USDC a verdict, with about 0.05 to 0.15 spent upstream.
   - A verdict takes about 5 to 7 s. The checks run in parallel, with p50 per
     check of 0.8 to 4.7 s.
   - Hard spend caps per call, verdict, key and day.
4. **Why someone would adopt it:**
   - It is cheaper and faster than an analyst's first pass.
   - Every decision is reproducible and signed, so it stands up to audits and
     disputes.
   - It pays only for the intelligence it uses.
   - It drops in through REST, the SDK, MCP, x402 or Telegraph itself.
5. **How to try it, and who maintains it.**
   - Try it via https://skeinlabs.site/tutorial, the free `/v1/quote`,
     `npm install @skeinlabs/sdk`, or one paid Telegraph ask to miner 845301.
   - Maintained by the Skein team at https://github.com/linoxbt/skein; issues
     and pull requests are welcome.

## Showcase permission

Telegraph may share publicly:
- this summary, the README and docs;
- screenshots and the demo recording;
- the tutorial;
- the live web app, Desk and Sniper feed.

Buyer introductions: *(yes or no, your choice)*.

## Before you submit

- [ ] Register at https://hackathon.telegraphprotocol.com, using **Register
      for Season II**. It needs your email and a one-time code.
- [ ] Star https://github.com/telegraphprotocol/bounties while signed in as
      `linoxbt`.
- [ ] Fill in your name and email, and the buyer-introductions answer, above.
- [ ] Submit through the H2 website by Dec 1, 23:59 UTC, pasting the sections
      above.
