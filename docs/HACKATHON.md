# Telegraph Hackathon Season II: what the rules ask, and where Skein stands

Read from https://hackathon.telegraphprotocol.com (home, /tracks, /missions,
/rules, mission pages) on 2026-11-14. The site is the authority; this is a map
for the team.

## Dates (UTC)

| Date | What |
|---|---|
| Nov 1 | Season II opens |
| **Nov 14** | First integration milestone (Apps & Agents): show a working Telegraph request or purchase, an attempt, or the blocker. A progress check, not a deadline |
| Nov 20 | Community showcase |
| Final week | Anjoman hands-on session |
| **Dec 1, 23:59** | Deadline, all tracks, through the H2 website |
| Dec 2–8 | Verification and judging (keep everything running) |
| From Dec 9 | Provisional results; 72 hours to appeal a factual mistake |

Prize pool: $10,000. Of it, $7,000 is for the main competition and $3,000 for
separate December challenges.

## Tracks and sub-tracks

| Track | What counts | Prizes | Skein |
|---|---|---|---|
| **01 Miners / Providers** | A working intelligence service answering an Intent, testable for quality | 4 × $300 delivery; excellence $500 / $300 | **Entered:** miner 5137 (catalogue 845301) on `FRAUD_RISK_GENERAL` |
| **02 Evaluators** | An evaluation adapter or material that measures an Intent's quality | 4 × $300; $500 / $300 | Not entered |
| **03 Apps & Agents** | A working app making at least one genuinely autonomous machine-to-machine purchase through Telegraph, used for a meaningful task | 8 × $225 delivery; excellence $700 / $350 / $150 | **Entered:** Skein Desk (mission 01) |

The 15 commercial missions are the Apps & Agents sub-tracks:

| Mission | Name | Mission | Name |
|---|---|---|---|
| 01 | Exchange | 09 | Personal Agent |
| 02 | Stablecoin | 10 | Model Economy |
| 03 | Institutional Markets | 11 | Autonomous Systems |
| 04 | Legal | 12 | Mining & Power |
| 05 | Conflict Intelligence | 13 | Asset Management |
| 06 | Resources & Agriculture | 14 | Web3 Native & DeFi |
| 07 | Consumer Platform | 15 | Consumer Automation |
| 08 | Commodities | | |

How Skein's apps map to them:
- **Skein Desk is mission 01's first example build**, "the autonomous listings
  desk". That example buys audit, on-chain metrics, sanctions, social bots and
  code review, and returns a signed listing risk memo with a cost line. Desk
  does exactly that through one Skein verdict.
- **Skein Sniper is mission 14's first example build**, "the rug-proof memecoin
  sniper" (audit, wash trading, on-chain metrics before any buy). It still buys
  through the partner-key API, so it does not show the required Telegraph
  purchase yet. The example's "execution on the sixth" has not happened either:
  no launch has been approved.

Delivery awards for Apps & Agents favour, in order: the most distinct completed
missions, the most distinct working apps, missions covered by only one group,
shared capabilities, quality, then correctness. A second app that really
completes mission 14 is worth more than polish on the first.

## Every entry must (rules §5)

1. Work: an app, a callable Provider service, or an Evaluator contribution.
2. Show a real Telegraph integration, with evidence for every claim.
3. Be repeatable: instructions for new inputs and error cases.
4. Handle things safely: permissions, spend limits, errors, keys.
5. Make accurate claims: name the network; keep testnet, internal and real
   demand apart.
6. **Star github.com/telegraphprotocol/bounties.** This is required, and the
   form asks for the GitHub username.

Mission acceptance, for each mission claimed: a reviewer can
1. run it with a new input;
2. check the result;
3. inspect the real Telegraph request and its evidence;
4. break it with a failure case;
5. reproduce it.

docs/REVIEWER_GUIDE.md walks through these five steps.

## Judging (out of 100; at least 70 to win)

Apps & Agents scoring:

| Points | What |
|---|---|
| 35 | Technical quality and mainnet readiness (minimum 24) |
| 25 | Commercial viability |
| 10 | Genuine independent adoption |
| 5 | Telegraph integration quality |
| 5 | Reproducibility and proof |
| **20** | Organic growth, education and developer activation |

The 20 growth points split into four parts of 5:
- **Content.** A public explanation, a technical tutorial, and honest
  limitations.
- **Ease of adoption.** Steps, a testable sample, costs and troubleshooting.
- **Organic distribution.** At least three original updates on separate dates;
  sharing beyond the team; technical follow-up.
- **Activation.** A specific invitation, plus evidence that an independent
  developer reproduced, tested or integrated.

Bought engagement, and self-dealing presented as external demand, are
disqualifying. Desk buying from Skein is the same team and is disclosed as such.

## What to submit (rules §8)

docs/SUBMISSION.md follows this order:
1. Project details: team and contact, track, name, missions or Intents, a
   working link, and the GitHub username that starred the bounties repo.
2. A 2–5 minute demo video showing the real input, the result and the
   Telegraph integration: `docs/demo/skein-motion.mp4`, 3:53.
3. How to run it: steps, prerequisites, config, a sample request, the expected
   result, the network, costs and limitations.
4. Evidence: receipts, requests, accounting, endpoints, evaluation methods and
   tests.
5. A short public summary, with links to the H2 updates, tutorials and any
   independent testing.
6. Showcase permission and buyer introductions.

Apps & Agents also answers five commercial questions. They are in
docs/SUBMISSION.md.

## Open items before Dec 1

- [ ] **Desk on Telegraph.** Set `DESK_PAYER=telegraph`, `DESK_PAYER_KEY` and
  `SKEIN_MINER_ID=845301` on Netlify. Without them, Desk shows no Telegraph
  purchase, the hard requirement of the Apps track.
- [ ] Star the bounties repo as `linoxbt`.
- [ ] Register on the H2 site and submit through it.
- [ ] Post at least three public updates on separate dates (the launch post is
  drafted in docs/demo/POST.md), and list them in SUBMISSION.
- [ ] Optional, for a second completed mission: move Skein Sniper to the
  Telegraph rail with its own funded payer key, a smaller daily budget, and SDK
  0.3.1 or the workspace SDK.
- [ ] Evidence pack: export the receipts (csv) and link a green CI run.
