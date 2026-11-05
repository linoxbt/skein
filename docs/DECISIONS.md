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

**D5. Spot checks must not trigger paid refreshes.** *(Built: the Telegraph-channel cap and the background refresh, D14.)*
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
  blocking finding. Together with D1, this makes "removing a required check's
  evidence never raises confidence" hold in every case. CI runs the property
  tests at 20,000 runs (`FC_RUNS=20000`); a plain `pnpm test` runs 200.
- The two monotonicity properties, as engine 0.2.0 states them (D14):
  - "Adding a PASS never raises risk" holds exactly for a PASS that answers an
    unanswered check (from any provider) or joins the deciding provider of an
    answered one. A *corroborating* PASS from another provider family can
    re-balance the independence groups and so move risk either way; that case
    is a consequence of independence weighting and is not claimed.
  - "Removing a finding never raises confidence" holds for a required check's
    whole evidence and for an agreeing duplicate. Removing a *dissenting*
    answer lifts a disagreement penalty by design, so it can raise confidence.
- `min_coverage` (row 3) cannot fire under any shipped policy: D1 already
  abstains on any missing required check, and the optional weights are too
  small to pull coverage below the minimum. The row stays as a guard for
  policies with heavier optional checks.

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
  per-run buffer, instead of a separate pg-boss worker. The audit (D14) showed
  the first version could lose receipts on a redeploy; since then each purchase
  is written as it is paid, a run's status lives in `verdict_runs`, SIGTERM
  drains running verdicts, and a sweeper marks runs that never finished as
  lost. The worker split comes when there is a second replica.
- **Partner keys:** stored as SHA-256 of a 256-bit random key, not argon2. Argon2
  protects low-entropy passwords; a random key needs no slow hash.
- **Web hosting:** Netlify (`skein-web.netlify.app`), not Vercel. Neither
  Vercel's nor a second Railway service was available: Vercel's GitHub app
  can't see the repo, and Railway's free plan allows no third service.
  `apps/web` has no workspace dependencies, so it is uploaded on its own
  (without `test/`) and built on Netlify with the Next.js runtime plugin. It
  is not connected to Git yet, so a push does not redeploy it. The Dockerfile
  (standalone, `BUILD_STANDALONE=1`) stays for any container host.
- **Default policy on the deployed service:** dex-list (`DEFAULT_POLICY`).
  cex-standard is refused until a miner supplies holder concentration (L2).
- **Partner keys without database access:** Railway Postgres is reachable only
  on Railway's private network, so the API seeds consumers at start from
  `SEED_CONSUMERS` (`name|kind|sha256|capUsdc`). Only the key's hash is ever
  in the environment, and a seeded consumer is inserted once.

**D12. Skein Desk is a pure consumer.** Desk (`apps/desk`) talks to Skein only
through `@skein/sdk`, as an outside team would, and keeps its own state (Netlify
Blobs in production, a folder in dev). It never reads Skein's database.
- **One agent per application:** every write is compare-and-swap (Blobs
  `onlyIfNew` / `onlyIfMatch`). An agent first takes a lease; only the lease
  holder buys or decides, and a decision is written once and never rewritten.
- **Never pays twice:** on the partner-key rail each application has one
  idempotency key (`desk-<application id>`). On the Telegraph rail the lease
  write also marks the application "buying", so the ask is made once; an ask
  that does not come back in 3 minutes goes to an analyst and is never retried.
- **Reads are reads:** the board and the application page only read. The agent
  runs on intake (waiting up to 8 s for the verdict) and on the scheduled tick
  every minute; nothing needs a person to move.
- **Intake limits, atomic:** per visitor address (Netlify's client-IP header)
  and per day, as counters written by compare-and-swap; a honeypot field stops
  naive bots. No contact details are collected.
- **Rails:** `DESK_PAYER=apiKey` (a partner key, free during the hackathon) or
  `DESK_PAYER=telegraph` (a burner with escrow funds; tested end to end against
  the fake node and Skein's own miner endpoint). The board's headline cost is
  the list price per verdict; what the Desk actually paid is shown beside it.
- **The exchange is fictional** (Halyard Exchange), and the Desk says on every
  page that the same team built it and that it is one consumer among several.

**D13. SDK and MCP.** `@skein/sdk` has no runtime dependencies and builds to
`dist` with tsup (`publishConfig` points the published package there; the
monorepo uses the TypeScript source). Every request has its own timeout and
retries stop at a 10 s budget, so a daily-cap 429 throws at once. A paid
Telegraph ask that yields no verdict throws with the payment attached. Its Telegraph
payer takes any client with an `ask()` (for example `TelegraphClient`), so
viem is not forced on browser users. `@skein/mcp` uses the official MCP
TypeScript SDK (1.32.1). It pays inside the server with a per-call cap
(enforced by the SDK before paying) and a per-session cap reserved before each
call, so concurrent calls cannot pass it together. The published binary bundles
the workspace packages it needs. Both are tested against the real API in-process
(`@skein/api/simulated`).

**D14. The audit of 2026-11-02, and what changed.** An independent review found
the money path unsafe; these are the decisions behind the fixes.
- **No retry after X-PAYMENT.** A paid call that times out, drops, 5xxs or
  returns an unreadable 200 may have been billed; it is reported at the signed
  amount with billing "unknown", counted against every cap, and never retried.
  Only failures before payment and an explicit 402 refusal are retried.
- **Sign only what was checked.** The escrow template is parsed strictly (the
  header, then exactly the eight documented lines, each once; the four signer
  fields as bare placeholders) and its Pay To, Network, Amount and Resource
  must equal the configuration and the challenge's own JSON (`amount`,
  `resource`, and any declared `asset`). A pinned ask must be for that miner's
  resource. Checked against a captured live 402 (L14).
- **Spend is held before it is spent.** `spend_holds`, under a Postgres
  advisory lock, holds each payment's allotment against the global, per-key and
  Telegraph-channel day caps; it settles to what was spent. Each purchase's
  allotment is its share of the verdict's cap, so no 402 can push a verdict past
  it.
- **Evidence is written as it is paid**, under a `verdict_runs` row created
  before anything is bought; the same row is the atomic idempotency claim.
- **Engine 0.2.0**, with 0.1.0 frozen under `src/frozen/` for replay: a
  domain-separated Merkle tree over 32-byte receipts; the policy file's sha256 in
  the verdict hash; an order-independent choice of each check's deciding answer
  (the strengthened property tests found the old hash depended on input order);
  best-answer confidence; blockers need `minConfidence` (0.5 by default); only
  answers are graded by thresholds. Policies are checked against the lock at
  load.
- **Adapters answer about the right thing:** the audit adapter needs the token
  it was asked about and the deciding flags; liquidity refuses another pool's
  reserve; sanctions caps the confidence of a name screen run on an address
  (`address_matching_unverified`), so a "match" escalates instead of rejecting.
- **No routed fallback:** a check with no live allowlisted miner is
  UNAVAILABLE (L4). Skein's own registrations (`SKEIN_SELF_REGISTRATION_IDS`)
  are never bought from.
- **Cache:** keyed on the request's normalised context too, and never serves
  ABSTAIN (usually a transient failure).
- **Pricing:** ABSTAIN is charged at upstream cost; the verdict's `cost` says
  which rule applied. Telegraph-channel verdicts record revenue owed. Charging
  partners on the direct API (x402 in) is not built: partner keys are free
  during the hackathon.
- **Kept as is, deliberately:** verdicts are public by id, and /v1/ledger lists
  the latest ten, because anyone must be able to verify any verdict. Row Level
  Security is enabled with no policies: it shuts out Supabase's browser roles
  where they exist and does nothing for the table owner the API connects as;
  the append-only and TRUNCATE triggers are what protect the evidence.



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


## What the live node said (2026-11-02)

**L14. A real 402, captured.** An unpaid ask to `/engine/v1/ask/7302` (free)
returned the escrow template the client expects, with two details the fake node
had wrong: the `Resource:` line names the miner (`/v1/ask/7302`), and the
`PAYMENT-REQUIRED` header's entries carry `amount` (and, for the x402 "exact"
entry, the USDC `asset`). Saved as `packages/telegraph/test/fixtures/live-402-7302.json`;
the client is tested against it and the fake node now matches it.

**L15. Intents.** On the Diamond, `isCanonicalIntent` is false for
`FRAUD_RISK_TOKEN_LISTING` (plan A) and true for `FRAUD_RISK_GENERAL` (plan B).
`/miner/verdict` accepts plan B's request shape (subject as an address string)
and answers `risk_level` beside the verdict.

**L16. The dispatcher forwards a miner's declared params as a flat JSON body**
(`/miner-dispatcher/openapi.json`), so `/miner/verdict` receives
`{ token, chain, policy }` as declared in the YAML.

**L17. The YAML validator URL the spec names answers 404.** `miner/validate.sh`
now fails loudly and takes `VALIDATOR_URL`; until the current endpoint is
known, validate in the integrate.telegraphprotocol.com web app.

**L18. Netlify Blobs: a get of a missing key never answers.** On Netlify's
runtime, `get` and `getWithMetadata` for a key that does not exist hang until
the function times out (30 s, a 502), in both consistency modes, while `list`,
writes and reads of existing keys answer in under half a second
(`@netlify/blobs` 11.1.4, measured 2026-11-02). That was the Desk's 502 in the
audit. The Desk's store now checks existence with a prefix `list` first, and
every Blobs call has an 8 s timeout so a hang surfaces as an error.

**L19. The `@skein` npm scope belongs to someone else.** It already holds an
unrelated package (checked 2026-11-04), so the public packages are
`@skeinlabs/sdk` and `@skeinlabs/mcp`, matching skeinlabs.site; the private
workspace packages keep `@skein/*`. The first packed `@skein/mcp` would also
have shipped type declarations importing a package nobody could install, so the
MCP server now depends on the published SDK, and the Telegraph rail ships as the
SDK's own `@skeinlabs/sdk/telegraph` entry (viem as an optional peer), with no
private code left to bundle. Both tarballs were installed into an empty project,
type-checked under `nodenext`, and run against the live API before release.

**L20. Signed verdicts, and a context mismatch that refused every rich application.**
Mission 01 (Exchange) asks for a *signed* listing risk memo. Every served
verdict now carries `attestation`: Skein's EIP-191 signature over a plain-text
message (id, subject, outcome, policy, engine, verdict hash, receipts root,
cost), signed on read (RFC 6979 makes it deterministic, so nothing is stored),
checked by `/v1/verify`, published at `/v1/status` (`attester`), and checkable
offline with `@skeinlabs/sdk/attest`, which rebuilds the message from the
verdict's own fields. The Desk renders it in a printable listing risk memo.
Building that memo surfaced a real bug: the Desk (and the SDK's own type)
sent `context.social` and `context.repo`, while the API's strict schema takes
`socialHandle` and `repoUrl`, so every application with a social handle or a
repo was refused as an invalid body, and the bot and code checks were never
bought. The SDK now maps the aliases, and the API names the offending field.

**L21. dex-list@0.2.0: code review; holder concentration stays a gap.** The
mission's listing desk buys "commit history and contributor authenticity"
through CODE_REVIEW; dex-list@0.1.0 never bought it. 0.2.0 adds it as an
optional check (weight 0.07, asked specifically about commit history,
contributor authenticity and copied code) and lowers min_coverage to 0.70 so
that, as in 0.1.0, all required checks answering is enough. 0.1.0 is unchanged
for anyone who pinned it. Holder *concentration* is still not bought: on
2026-11-05 no intent returns a holder distribution (ONCHAIN_METRIC_VERIFY is a
wallet's ETH balance at a block; TOKEN_HOLDER_COUNT is a count; the only other
token intent is total supply), and mapping it onto one of those would be a fake
check. It is reported as not covered.
