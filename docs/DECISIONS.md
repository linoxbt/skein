# Decisions and spec deviations

This file records where the code departs from the build spec, and why. The
first group fixes problems in the spec's scoring rules. The second records
what the live Telegraph node said on 2026-10-30, when it was read through its
free endpoints (no paid calls). Each item names the code or test that holds it.

## Scoring and policy fixes

**D1. A missing required check forces ABSTAIN, whatever its weight.**
In the spec, `sanctions` is required but has no weight, and coverage is
"covered required weight ÷ total required weight". So a sanctions timeout left
coverage at 100% and the verdict went ahead, which contradicted the demo's
refusal scene and the failure-case table. The fix: decision row 2 is now "a
required check has no real answer → ABSTAIN, naming the check, with confidence
0" (`decision.abstain_on_missing_required`). The policy schema also rejects a
required check that has neither a weight nor a blocker.
Test: `decide.test.ts` › D1.

**D2. Coverage is measured against the whole policy.**
With D1 in place, coverage now means "covered weight ÷ total policy weight",
required and optional together. `min_coverage` still guards policies that lean
on optional checks. In cex-standard, a missing `liquidity_depth` used to leave
coverage at 0.82, above the 0.80 minimum. It now gives ABSTAIN through D1.
Test: D2.

**D3. A required FAIL can never be approved, and severity scaling is defined.**
Under the spec's weights, a liquidity FAIL with everything else PASS scored
about 1,500 bps, under the approve threshold, so the token was approved. Row 6
now sends any required FAIL to ESCALATE (`decision.required_fail_blocks_approve`).
"Scaled by severity" is now an explicit, tunable table:
`risk = status_risk[status] × severity_multiplier[severity]`, with defaults
`{PASS 0, WARN 0.5, FAIL 1}` × `[0.6, 0.8, 1.0, 1.0]`.
Test: D3, plus the property test "a required check at FAIL is never approved".

**D4. REJECT on risk is checked before contradictions.**
The spec ran the conflict check (row 3) before the risk check (row 4), so a
token at 9,000 bps with a conflict came out as ESCALATE. The two rows are now
swapped. The conflict is still listed in `decision.conflicts`.
Test: "row 4 before row 5".

**D5. Spot checks must not trigger paid refreshes.** *(API work, not built yet.)*
Validators spot-check about every 20 seconds. If each spot check bought a fresh
verdict (about $0.09), that would cost about $390 a day against a $10 daily cap.
The rules for the API:
- A cache hit refreshes in the background only when the cached verdict is older
  than `CACHE_REFRESH_MIN_AGE_SEC` (480 seconds).
- Uncached spot checks spend from a separate `SPOTCHECK_DAILY_CAP_USDC`.
- Once that cap is hit, a spot check on an uncached token is answered as ABSTAIN
  with no purchase.

Whether spot checks are paid, and which tokens they use, is an open question
for Nov 1.

**D6. Price rules differ between the two ways in.**
"ABSTAIN is charged at upstream cost" and "a failed verdict is not charged"
can only be enforced on the direct API. On the Telegraph path, the network bills
any successful answer at the floor price times the demand multiplier, and only
failed calls go unbilled. Telegraph-routed ABSTAINs are therefore billed in
full. The verdict's `cost` object must say which rule applied.

**D7. The benchmark checks each token as it was at a point in time.**
A rug from months ago has no liquidity today, and a token listed for six months
passes easily, so scoring either one on today's state flatters the results. Each
labelled case records an `as_of_block` from before its label event, and every
check in the benchmark reads state at that block. A check that can't read
historical state is reported as current-state-only. See `eval/README.md`.

**D8. Smaller fixes.**
- The spec's example verdict claimed coverage 0.92, but its only open risk was
  an optional check. With D2 its coverage is 1.00 ÷ 1.05 = 0.9524 (test D8).
- The risk denominator is the effective weight of answered checks, required and
  optional (`score.ts`).
- `reproduce()` re-runs each adapter on the stored `raw_result`, using the
  adapter version recorded at the time, before re-running the engine. That
  catches a finding that no longer matches its raw answer, not just engine drift.
- The engine version is part of the verdict hash.
- Verdict codes are ABSTAIN 0, APPROVE 1, ESCALATE 2, REJECT 3. Zero (the default
  value of an unset on-chain field) therefore never reads as APPROVE.
- When a blocker decides the verdict, its confidence is the confidence of the
  blocking finding. Together with D1, this makes "removing a required finding
  never raises confidence" hold in every case (property test, 20,000 runs).

**D9. Adapter versions are never deleted.**
A stored verdict replays with the adapter version that made it. Changing an
adapter therefore means publishing a new version and keeping the old one in
`SUPERSEDED` (`adapters.ts`). A test lists every published version and fails if
one disappears. `sanctions` and `liquidity_depth` went to 0.2.0 on Oct 30 to
read the native fields of two allowlisted miners (L11).

**D10. Upstream timeouts use a referenced timer.**
`AbortSignal.timeout()` uses an unreferenced timer in Node, so a worker or CLI
process with nothing else pending exited mid-verdict while a miner hung. The
client now aborts with its own `setTimeout`, cleared after each call.

**D11. Hosting deviations for the hackathon build.**
- **Database:** Railway Postgres, not Supabase. The Supabase org's free plan
  allows 2 active projects and both slots were in use. The schema has no
  Supabase-specific parts (RLS and the browser-role revokes apply wherever the
  roles exist), so moving means changing `DATABASE_URL`, plus `DATABASE_CA_CERT`
  for Supabase's TLS root.
- **Background runs:** verdicts run in-process in the API, with SSE from a
  per-run buffer, instead of a separate pg-boss worker. At one replica this is
  simpler and loses nothing. The worker split comes when there is a second
  replica.
- **Partner keys:** stored as SHA-256 of a 256-bit random key, not argon2. Argon2
  protects low-entropy passwords; a random key needs no slow hash.
- **Default policy on the deployed service:** dex-list (`DEFAULT_POLICY`).
  cex-standard is refused until a miner supplies holder concentration (L2).

## What the live node said (2026-10-30)

Snapshot: `packages/telegraph/snapshots/2026-10-30.json`. Re-check all of this on Nov 1.

**L1. Intent ids end in `_GENERAL`** (`SMART_CONTRACT_AUDIT_GENERAL`, …). All
eight input intents exist, each with 11–35 miners and a $0.01 floor
(`min_price_usdc: 10000` in micro-USDC). All are class `judgment`; the spec's
Deterministic/Hybrid labels came from the mission pages.

**L2. No intent supplies holder concentration.** `ONCHAIN_METRIC_VERIFY` takes
`{address, block}` and returns an ETH balance (`balance_gwei`).
`TOKEN_HOLDER_COUNT` returns a holder count, not a share. So:
- `holder_concentration` maps to no intent, and cex-standard stays unplannable
  (UPSTREAM_UNAVAILABLE) until a disclosed miner supplies the top-10 share
  (spec §18).
- A new check, `holder_count`, uses TOKEN_HOLDER_COUNT. It is optional in
  cex-standard and required in dex-list and agent-pretrade, so those two
  policies can be planned on today's intents.

**L3. The live schemas differ from the spec's assumptions.**
- `LIQUIDITY_DEPTH_VERIFY` takes `{pool, chain}`, not a token, and returns
  `liquidity_usd` (the pool's total reserve), not 2% depth. Thresholds were
  re-based (about 0.5% of reserve ≈ 2% depth). Skein must resolve the token's
  main pool before buying this check.
- `SANCTIONS_SCREENING_MATCH` takes a person or entity *name* and returns
  `matched`. Whether any of its miners matches a 0x address is untested.
- `SMART_CONTRACT_AUDIT` has no response format (`onchain.ready: false`).
- `WASH_TRADING_DETECTION`, `SOCIAL_BOT_DETECTION` and `CODE_REVIEW` return
  verdict enums, which the adapters map.

**L4. Routed calls can buy irrelevant answers, so Skein pins miners.** Most
miners on these intents wrap a fixed endpoint that ignores the token, such as
Hacker News feeds on SOCIAL_BOT_DETECTION, academic search on
SMART_CONTRACT_AUDIT, and a static OFAC index on SANCTIONS_SCREENING_MATCH. The
purchaser uses `/engine/v1/ask/{miner_id}` with the allowlist in
`packages/telegraph/src/allowlist.ts`. Each entry needs one paid test answer on
Nov 1.

**L5. Independence groups matter today.** The strongest candidates for wash
trading, holder count, liquidity and social bots all come from one operator
(`*.margyn.workers.dev`). Many other miners share one IP host. `sourceGroup()`
merges each into one provider family.

**L6. `FRAUD_RISK_GENERAL` already exists.** It has 11 miners, all IP, URL or
payment-fraud feeds. Its request is `subject`, and its on-chain response is a
single `risk_level` enum. It is the natural Plan B (`miner/INTENT_PROPOSAL.md`).
Intents define their own on-chain layout, so the YAML's `on_chain` block must
follow whatever the intent is approved with.

**L7. `/api/miners` does not expose rank.** It returns `min_price_usdc`,
`activation_status`, `scored` and `total_requests_served`. Rank has to come from
elsewhere (the leaderboard) or be dropped from the Finding.

**L8. BNB coverage is thin.** VerifyWire and ChainWire read Ethereum, Base,
Arbitrum, Optimism and Polygon, but not BNB.

**L9. The testnet is Ethereum Sepolia, with a new Diamond.** Read from the docs'
Addresses page and from live 402 challenges:
- network `eip155:11155111`
- Diamond `0x3624EB01…99b`, which is also the escrow `payTo`
- test USDC `0xcc194e1a…E17`, which anyone can mint

The spec's Oct 28 values (Base Sepolia, Diamond `0x5a23…`) are out of date.
`packages/telegraph/src/config.ts` holds the current defaults, and the client
refuses any challenge whose network, `payTo` or amount disagrees with them.

**L10. Registration takes a bond, not just gas.** Registering a miner takes
MACHINA worth $1 for the first intent and $0.10 for each further one, returned on
deregistration. Proposing an intent also posts a $1 MACHINA bond. MACHINA is
bought by swapping test USDC on the Sepolia pool.

**L11. Not every allowlisted miner takes canonical params.** These were checked
with unpaid requests: a 402 means the node accepted the request, a 503 means it
cannot take it.
- **Accept canonical params:** GoPlus (question plus context), ChainWire,
  VerifyWire wash trading and liquidity, and TradeWire.
- **Refuse them:** the OFAC SDN screen (it wants `entity`) and GeckoTerminal (it
  wants `address`). These two are asked in the native form. Every other liquidity
  miner except VerifyWire refuses canonical `{pool, chain}`.
- **Accept a name but ignore it:** most sanctions miners with no input, such as
  static indexes. They would take payment for an irrelevant answer.

The purchaser tries allowlisted miners in order. When one refuses before payment
(503 `no_compatible_miner`, which costs nothing), it moves to the next.

**L12. Answers come back shaped.** `/engine/v1/ask` returns `result` in the
intent's response format, with `result_shape` and per-field `field_status`. A
field the node could not read is `null` and never a guess. The native form
returns the miner's raw output. The signed `signal_hash` always covers the raw
answer.

**L13. The YAML `on_chain` block no longer drives jobs.** Since V2, jobs are
built from the intent's own on-chain layout, so the intent proposal defines what
a contract receives. Each endpoint now has to declare `intents` (required) and
`params`, and the draft YAML does both.
