# Guide 3 · Building the labelled evaluation set

> **Status, 2026-11-07: a first set is built; the labels await your review.**
> `eval/cases.json` holds 66 current-state cases: 34 good, 32 bad; 44 tune, 22 holdout.
> - **Good** (`eval/sources/good.json`): chosen by a written rule rather than
>   by hand (`eval-tools good-from-coingecko`).
> - **Bad** (`eval/sources/bad.json`): researched incidents, each with a source
>   that names the token contract (`eval/sources/bad-candidates.json` has the
>   evidence line for each). Every address is checked on-chain.
> - **Ambiguous:** comes from the prospective set (`eval-tools prospective`). It
>   labels the sniper's launches 72 hours after their verdicts.
>
> One correction to this guide: the miners Skein buys from read only current
> state, so a case cannot be checked "as of" a past block (DECISIONS L26).
> Current-state results answer "would Skein stop this listing today". The
> prospective set is the point-in-time measure. Step 5 below describes the
> original plan.
>
> **What is left for you:** read each bad case's source and confirm the label
> (open `eval/sources/bad-candidates.json`; five Base honeypots rest on the
> honeypot.is detector alone and say so), and look over the good rule's
> output. Change a label by editing `eval/cases.json`, never a split.

**Time:** a few hours of research, spread out as you like. **Cost:** about 6
test USDC to run (from the purchaser wallet, guide 1). **Output:**
`eval/cases.json`, about 90 tokens, each with a public source.

## What it is, and why judges care

Skein's claim is that its fused verdict beats any single check. The evaluation
proves it, or shows where it doesn't, on tokens whose outcome is already
publicly known. Every number is reported, including the bad ones; that honesty
is what makes it credible.

Nobody hands you this set. You **curate** it from public sources, and no part
of it is generated. That rule is in `eval/README.md`, and the report refuses
to present a file marked `"kind": "example"` as results.

## The shape of the set

| Group | How many | Meaning | Where to look |
|---|---|---|---|
| **good** | about 30 | Listed on two or more major exchanges (Coinbase, Binance, Kraken, OKX) for 6 months or more | CoinGecko or CoinMarketCap "Markets" tab; the exchange's own asset page |
| **bad** | about 30 | A documented honeypot, rug pull or drainer token | rekt.news, the De.Fi REKT Database, CertiK Alert, PeckShield, Token Sniffer or honeypot.is reports |
| **ambiguous** | about 30 | New tokens with mixed signals: no verdict is obviously right | DEX Screener "new pairs" on Base, BNB Chain or Ethereum |

- **Chains:** Ethereum (1), BNB Chain (56), Base (8453), Arbitrum (42161).
  Mostly Ethereum, Base and BNB, about 30 each.
- **Split:** decide it when you add the case and never change it. About 60
  cases are `tune` (thresholds are adjusted on these) and 30 are `holdout`
  (never looked at until the final run). Put 10 of each group in holdout.
- **Every label needs a public URL** that names this specific token, by address
  or unmistakably by name and chain.

## Step by step

### 1. Start a spreadsheet (Google Sheets is fine)

One row per token, with these columns:

| id | chainId | token | label | labelSourceUrl | labelEventAt | asOfBlock | split | notes |
|---|---|---|---|---|---|---|---|---|
| bad-001 | 56 | 0x… | bad | https://… | 2024-05-02T00:00:00Z | 38512345 | tune | Honeypot: sells blocked by owner-only transfer check |

Send me the sheet (or its CSV) and I'll turn it into `eval/cases.json` and check it.

### 2. Collect the bad tokens first (they are the hardest)

For each incident:

1. Find a **write-up that gives the token's contract address**: a rekt.news
   article, a CertiK or PeckShield alert, a Token Sniffer or honeypot.is page.
2. Open the address on the chain's explorer (etherscan.io, bscscan.com,
   basescan.org, arbiscan.io) and confirm it is the **token contract**, not the
   liquidity pair, a router, or the deployer.
3. Note **when** it happened, from the write-up or the explorer: the rug
   transaction, or the date of the first report. That is `labelEventAt`.
4. Prefer incidents from 2023 to 2025 on the four chains above. Skip tokens
   whose only source is a social post that doesn't name the address.

### 3. Collect the good tokens

Well-known, long-listed tokens: for example the stablecoins, wrapped ETH, and
the major DeFi governance tokens on each chain. For each:

1. Use the **contract address from the exchange or the project's official
   docs**, never one from a search result.
2. The source URL can be the CoinGecko page that lists the contract and its
   exchange markets, or an exchange's listing announcement.
3. Note the date it reached its second major exchange. Its six months start then.

### 4. Collect the ambiguous tokens

New tokens (launched within the last month) with mixed signals: some liquidity,
a short history, an unverified or recently changed contract, concentrated
holders. Use the DEX Screener pair page as the source URL, and write the mixed
signals in `notes`. These test whether Skein ESCALATEs or ABSTAINs instead of
guessing.

### 5. Pin each case to a block (`asOfBlock`)

A token's state **today** doesn't describe its state at listing time: a drained
rug fails liquidity trivially, and an old blue chip passes trivially. So every
case is checked as of a block:

| Label | asOfBlock is | Example |
|---|---|---|
| bad | a block **before** the event, usually 1 day before `labelEventAt` | rug on 2024-05-02 → block on 2024-05-01 |
| good | a block near the **start** of its 6 months on exchanges | second listing on 2023-09-10 → block on 2023-09-12 |
| ambiguous | the block on the day you **collected** it | today |

Convert a date to a block with the tool I added (free, no keys needed):

```sh
pnpm --filter @skein/eval eval-tools block-at bsc 2024-05-01
# {"chainId":56,"at":"2024-05-01T00:00:00.000Z","asOfBlock":…,"blockTime":"…"}
```

Works for `ethereum`, `bsc`, `base` and `arbitrum`. Or send me the dates and I'll fill the column.

### 6. Check the file

```sh
pnpm --filter @skein/eval eval-tools check eval/cases.json
```

It validates every field. It also shows the balance by label, split and chain,
and warns about:
- duplicates;
- bad cases without an event date;
- a holdout share far from one third;
- a file still marked as an example.

The file's format:

```json
{
  "kind": "labelled",
  "cases": [
    {
      "id": "good-001",
      "chainId": 8453,
      "token": "0x4200000000000000000000000000000000000006",
      "label": "good",
      "labelSourceUrl": "https://docs.base.org/docs/base-contracts",
      "asOfBlock": 11230926,
      "split": "tune",
      "notes": "WETH on Base, predeploy"
    }
  ]
}
```

| Field | Rules |
|---|---|
| `id` | lowercase letters, digits and dashes, 3 to 64 characters, unique |
| `chainId` | 1, 56, 8453 or 42161 |
| `token` | `0x` and 40 hex characters |
| `label` | `good`, `bad` or `ambiguous` |
| `labelSourceUrl` | an `https://` URL, required for every case |
| `labelEventAt` | ISO time of the rug, report or listing (strongly advised for bad) |
| `asOfBlock` | a positive block number on that chain |
| `split` | `tune` or `holdout`, fixed once set |
| `context` | optional: `deployer`, `socialHandle`, `repoUrl` |
| `notes` | optional, up to 500 characters |

### 7. Run it (after guide 1)

```sh
export PURCHASER_PRIVATE_KEY=0x…    # or ask me to run it from here
# tune split first: adjust thresholds only on these results
pnpm --filter @skein/eval eval run eval/cases.json --split tune --out eval/runs --live --yes --max-total-usdc 5
# then, once, the holdout split
pnpm --filter @skein/eval eval run eval/cases.json --split holdout --out eval/runs --live --yes --max-total-usdc 3
# the report: Skein against the baselines, with 95% bootstrap intervals
pnpm --filter @skein/eval eval report eval/cases.json eval/runs --split holdout > eval/REPORT.md
```

Every run stops before passing `--max-total-usdc`. The report gives:
- precision and recall on REJECT;
- the **false-APPROVE rate on bad tokens**, the number that matters most;
- the ESCALATE and ABSTAIN rates;
- cost and latency per verdict;
- the same metrics for each simpler alternative.

## How I can help

- **A first draft.** I can research candidates with sources and send you a
  sheet to review. You check each label against its source, because the labels
  have to be yours.
- **Conversion.** Send me your sheet and I'll fill `asOfBlock`, convert it to
  `cases.json`, run the check and commit it.
- **The runs.** Once guide 1 is done, I can run the evaluation and write up the
  report with you.
