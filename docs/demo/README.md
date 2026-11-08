# Demo films

## skein-motion.mp4: the narrated demo (3 min 10 s)

The main demo. It is motion graphics built with Remotion from the live
product (`video/`). The narration is Kokoro-82M, voice `af_heart`; the music
and sound effects are from Mixkit; the type and brand are the site's own.

Every product screen is a capture of the live services. The Desk scene is a
real application recorded as it ran: the agent bought
[`vrd_mw8dfz384v6a6v094n03`](https://skeinlabs.site/v/vrd_mw8dfz384v6a6v094n03)
through Telegraph testnet, APPROVE for AERO on Base, sealed in 5.8 s, with
five paid receipts. The evidence and verify scenes show that same verdict.

Audio is mastered to −14 LUFS, true peak −1.5 dB.

Narration script (the text equivalent): `video/scripts/script.json`. In that
file "Skein" is spelled "Skane", so the voice says it right.

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
    launches. It dodged every launch it checked.
13. Open APIs: live miner health, latency and spend caps. Use the SDK, the MCP
    server, x402 payments, or Telegraph itself.
14. Try it: skeinlabs.site/tutorial, `npm i @skeinlabs/sdk`,
    github.com/linoxbt/skein.

To record it again: `node scripts/record-demo.cjs` (Playwright; it buys one
real verdict).
