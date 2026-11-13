# @skeinlabs/mcp

[Skein](https://skeinlabs.site) as a Model Context Protocol server. It gives
Claude, Cursor or any MCP client three tools for checking an EVM token
before an agent lists it, trades it or pays it out:

| Tool | Cost | What it returns |
|---|---|---|
| `skein_quote` | free | What a verdict would buy and cost, or why it would be refused |
| `skein_verdict` | paid | APPROVE / REJECT / ESCALATE / ABSTAIN, with reasons, open risks, cost and a verify link |
| `skein_verify` | free | Whether the verdict hash and the receipts' Merkle root recompute |

The server pays inside, with a per-call cap and a per-session cap, so an agent
cannot overspend however it loops.

**[Read the full tutorial →](https://skeinlabs.site/tutorial)**

## Claude Code

```sh
claude mcp add skein --env SKEIN_API_KEY=sk_part_… -- npx -y @skeinlabs/mcp
```

## Claude Desktop, Cursor, Windsurf

Add to the client's MCP config (`claude_desktop_config.json`, `.cursor/mcp.json`, …):

```json
{
  "mcpServers": {
    "skein": {
      "command": "npx",
      "args": ["-y", "@skeinlabs/mcp"],
      "env": { "SKEIN_API_KEY": "sk_part_…" }
    }
  }
}
```

Without a key, `skein_quote` and `skein_verify` still work; `skein_verdict` refuses.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `SKEIN_API_KEY` | | A Skein partner key (free during the hackathon) |
| `SKEIN_PAYER_KEY` | | Instead of a key: a burner private key that pays each verdict through Telegraph escrow |
| `SKEIN_INTENT` | `FRAUD_RISK_GENERAL` | With `SKEIN_PAYER_KEY`: the Telegraph intent asked |
| `SKEIN_MINER_ID` | `845301` | With `SKEIN_PAYER_KEY`: the miner pinned (Skein's). Answers from any other miner, or about another token or policy, are refused |
| `SKEIN_MAX_USDC_PER_CALL` | `0.30` | No verdict is bought above this |
| `SKEIN_SESSION_CAP_USDC` | `2` | What one server process may spend in total. `SKEIN_DAILY_CAP_USDC` is read as a deprecated alias: the cap is per process, not per day |
| `SKEIN_API_KEY_BILLING` | `list` | `list`: a partner-key verdict counts at Skein's list price against the session cap (a free key costs nothing, but the cap stays meaningful); `free`: it counts 0 |
| `SKEIN_API_URL` | `https://api.skeinlabs.site` | |
| `SKEIN_WEB_URL` | `https://skeinlabs.site` | Where verify links point |
| `TELEGRAPH_*`, `RPC_URL` | Telegraph testnet | Network settings for the Telegraph rail |

The caps must be positive numbers: a value like `2usdc` stops the server
with a message rather than turning the cap off. A Telegraph ask is counted at
what it cost, even when Skein answered from cache. The Telegraph rail sends
only the subject and the policy.

stdout carries the protocol; logs go to stderr.

## As a library

```ts
import { Skein } from "@skeinlabs/sdk";
import { createSkeinMcp } from "@skeinlabs/mcp";

const { server } = createSkeinMcp({
  skein: new Skein({ apiUrl: "https://api.skeinlabs.site", payer: { kind: "apiKey", key }, maxUsdcPerCall: 0.3 }),
  webUrl: "https://skeinlabs.site",
  sessionCapUsdc: 2,
  maxUsdcPerCall: 0.3,
});
// connect `server` to any MCP transport
```

Verdicts are risk evidence, not investment advice.

## License

Apache-2.0
