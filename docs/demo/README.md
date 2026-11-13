# Demo films

## skein-teaser.mp4: the 42-second teaser (no narration)

[skein-teaser.mp4](skein-teaser.mp4) is a wordless intro for social posts
(`video/src/teaser`). There are no screen recordings: it animates what Skein
does, with real data throughout.

- **The launches:** the day's Base launch count from the Sniper feed, and the
  real launches, red where they went to zero.
- **The purchases:** the five ranked miners and receipt hashes from
  `vrd_mwcfyu0y04360z153f1b`.
- **The verdicts:** the AERO approval and the Lazarus Group rejection.
- **The proof:** the Merkle root and the verify checks.
- **The results:** the prospective benchmark result and the ledger totals.

It is cut to Mixkit's "No Warning" (Michael Ramir C.). The music is edited
on bar lines so the logo lands on the drop and the end card on the track's
final hit. The audio is mastered to −14 LUFS.

The post to go with it is in [POST.md](POST.md).

## skein-motion.mp4: the narrated demo film (3 min 48 s)

The main demo. It is a motion film built with Remotion from the live product
(`video/src/v2`). The type, colours, mark and thread motifs are the site's
own. Captions are burned in.

**Live events.** Two were recorded on Nov 11, 2026, against the production
services on Telegraph testnet:
- **The Desk.** A listing application for Aerodrome (AERO) on Base bought
  [`vrd_mwcfyu0y04360z153f1b`](https://skeinlabs.site/v/vrd_mwcfyu0y04360z153f1b):
  APPROVE, 5.4 s, five paid receipts, 0.05 USDC upstream. The desk shortlisted
  it.
- **The console.** It screened an address on the OFAC SDN list (Lazarus
  Group, uid 27307) and got
  [`vrd_mwcfy2nj685b1z0e264a`](https://skeinlabs.site/v/vrd_mwcfy2nj685b1z0e264a):
  REJECT at full confidence. The evidence names the SDN entry and the list
  file's sha256.

Both verdicts recompute on `/verify`.

**Real data.** Every number comes from the live services or the repository.
- The miners, costs and receipt hashes are the AERO verdict's.
- The cold-open wall is real Base launches the Sniper checked. Red means the
  launch went to zero afterwards.
- The backtest is `eval/FINDINGS-sniper.md`.
- The benchmark is the first prospective run, published on the
  `data/prospective` branch.

The vendor panel in the problem scene is illustrative, and labelled so.

**Sound.**
- **Narration:** Kokoro-82M, voice `af_heart`. Word timings come from
  faster-whisper, so visuals and effects land on the spoken word.
- **Music:** "We Will Get It" by Eugenio Mininni (Mixkit). It is edited so its
  break falls under "twenty-seven went bad" and its climax lands on "approved
  none of them".
- **Effects:** about 200 cues from Mixkit's library.
- **Master:** −14 LUFS, true peak −1.5 dB.

Narration script (the text equivalent): `video/scripts/script-v2.json`. In
that file "Skein" is spelled "Skane", so the voice says it right.

## skein-demo.mp4: the plain screen walkthrough (2 min 33 s)

[skein-demo.mp4](skein-demo.mp4) is a screen recording of the live services,
made on 2026-11-08. Nothing in it is mocked. The Desk application it submits
bought a real verdict through Telegraph testnet during the recording:
[`vrd_mw8c7dkh4a1d465l3u5f`](https://skeinlabs.site/v/vrd_mw8c7dkh4a1d465l3u5f).
That verdict was APPROVE for Aerodrome (AERO) on Base, took 5.9 s, and spent
0.05 USDC on five paid checks.

Captions, in order (the text equivalent of the video):

1. Skein sells one decision: is this token fit to list? It buys ranked checks
   from Telegraph miners and fuses them into a verdict.
2. APPROVE, REJECT, ESCALATE or ABSTAIN, with reasons, cost and a receipt for
   every purchase.
3. Skein Desk, an exchange listing queue run by an agent. It buys a Skein
   verdict for every application, with no human in the loop.
4. A project applies to list its token. The real input is Aerodrome (AERO) on
   Base.
5. Submitted. The Desk agent pays Skein, and Skein pays Telegraph miners
   through the escrow for each check.
6. Buying checks live on Telegraph testnet: contract audit, sanctions,
   holders, liquidity, wash trading.
7. The agent decided on its own: the verdict, its reasons, and what it cost.
8. The verdict page: decision, reasons, open risks, risk and confidence,
   coverage and cost, signed by Skein.
9. Evidence: every Telegraph purchase, with its miner, price, receipt hash and
   signal hash.
10. Anyone can verify it. Skein recomputes the verdict from the raw answers it
    paid for and checks every receipt.
11. The ledger: every verdict and every upstream receipt, from 9 miners so far.
    Skein is also miner 5137, selling verdicts to other agents.
12. Skein Sniper (Mission 14) buys a verdict before every trade on new Base
    launches. It has checked 280 and bought none. That is a strict gate, not
    foresight, so every launch is labelled 72 hours later and the results are
    published daily.
13. Open APIs: live miner health, latency and spend caps. Use the SDK, the MCP
    server, x402 payments, or Telegraph itself.
14. Try it: skeinlabs.site/tutorial, `npm i @skeinlabs/sdk`,
    github.com/linoxbt/skein.

To record it again: `node scripts/record-demo.cjs` (Playwright; it buys one
real verdict).
