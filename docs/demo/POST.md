# Launch post

Video: [`skein-teaser.mp4`](skein-teaser.mp4) (42 s, no narration, 1080p).

## X (one post, 262 characters as X counts them)

> 1,627 tokens launched on Base in a day. Some are honeypots. Some get rugged. Some come from sanctioned wallets.
>
> Is this one safe to list? Skein answers in one request: five checks bought from ranked Telegraph miners, one signed verdict.
>
> skeinlabs.site

## X (thread, optional follow-ups)

> 2/ Every verdict is APPROVE, REJECT, ESCALATE or ABSTAIN, never a guess. It comes with its reasons, its cost, and a receipt for every paid check, rolled into one Merkle root and signed.

> 3/ Out of sample: 40 launches labelled 72 hours after Skein's verdict. 27 went bad. Skein approved none of them. Simpler rules on the same data let 22% through.

> 4/ It also screens addresses against the OFAC sanctions list. A Lazarus Group wallet gets REJECT at 100% confidence, with the list entry as evidence.

> 5/ Try it:
> - REST: api.skeinlabs.site
> - npm i @skeinlabs/sdk
> - npx -y @skeinlabs/mcp (Claude, Cursor)
> - pay per verdict with x402
> - or ask Telegraph miner 845301
>
> Code: github.com/linoxbt/skein

## LinkedIn

> **Is this token safe to list?**
>
> 1,627 new tokens launched on Base in the last 24 hours. Listing teams, launchpads and trading agents have to decide which ones to touch, usually by stitching together several risk vendors and an analyst's afternoon.
>
> Skein turns that into one request.
>
> 1. It plans the checks a listing policy needs: contract audit, sanctions, holders, liquidity, wash trading.
> 2. It buys each one from the best-ranked miner on the Telegraph network and pays it through the Telegraph escrow.
> 3. Fixed, versioned rules fuse the answers into APPROVE, REJECT, ESCALATE or ABSTAIN.
>
> Every verdict carries its reasons, its cost, and a receipt for every paid check, rolled into one Merkle root and signed. Anyone can recompute it from the raw answers at skeinlabs.site/verify.
>
> It is measured in the open. On 40 launches labelled 72 hours after the verdict, 27 went bad. Skein approved none of them; simpler rules on the same data let 22% through.
>
> Built for Telegraph Season II. Try it at skeinlabs.site, `npm i @skeinlabs/sdk`, or as an MCP server for Claude and Cursor.

## Sources for the numbers

- **1,627 launches in 24 hours:** the Skein Sniper feed (`last24h.seen`), Nov 11, 2026.
- **40 / 27 / 0 / 22%:** the prospective benchmark, published on the `data/prospective` branch (`REPORT.md`).
- **Lazarus Group REJECT:** [`vrd_mwcfy2nj685b1z0e264a`](https://skeinlabs.site/v/vrd_mwcfy2nj685b1z0e264a).
- **Teaser totals (312 verdicts, 819 paid receipts, 10 miners):** `/v1/ledger`, Nov 11, 2026.
