# Disclosures

## Built by the same team

Skein (the Provider) and Skein Desk (the Apps & Agents entry) are built by the
same team. Halyard Exchange, the Desk's exchange, is fictional. The Desk is one
consumer of Skein among others and talks to it only through the public SDK.

## Reused libraries

Runtime: `zod`, `@noble/hashes`, `yaml`, `viem`, `drizzle-orm`, `pg`, `hono`,
`@hono/node-server`, `next`, `react`, `tailwindcss`, `@netlify/blobs`,
`@modelcontextprotocol/sdk`. Tooling and tests: `drizzle-kit`,
`@electric-sql/pglite`, `vitest`, `fast-check`, `playwright`, `axe-core`,
`tsup`, `tsx`, `turbo`, `@netlify/plugin-nextjs`. No templates were used.

## Non-Telegraph dependencies

- **DexScreener's public token endpoint** finds a token's main pool, which the
  liquidity check needs as input. The liquidity figure itself is bought through
  Telegraph; the lookup is not evidence.
- **A public Sepolia RPC** reads the purchaser wallet's USDC balance for the
  /v1/status alert, and the miner tools read escrow balances.

## Data

Skein and the Desk collect no personal data. The Desk's form takes a project
name, a token and optional public handles; it does not ask for contact
details. The one exception is the GitHub issue form for requesting a partner
key, which asks for a contact (email or Discord) so the key can be delivered;
it lives on GitHub, under GitHub's terms, and is not stored by Skein. Verdicts are
public by id, by design: anyone can verify any verdict.

## Accuracy

- Every screen labels the network. Simulated data is labelled as such
  wherever it appears.
- Nothing from before the event period (Nov 1, 2026 UTC) is presented as event
  activity: the client refuses paid calls before it.
- The benchmark (eval/) reports the labelled holdout and the daily prospective
  run with 95% Wilson intervals and every baseline, including where a simpler
  rule did as well (README, Results).

## Related wallets (all on testnets)

| Role | Address |
|---|---|
| Purchaser (buys inputs on Telegraph) | 0xC14B8719F49165Ab34E741B441Ca3c6720dd6c8a |
| Attester (signs every verdict) | 0x07Dee32979AE8C17415Bd6d6939bA0d815639309 |
| x402 payee (direct API, Base Sepolia) | 0x4EbCF8147a7F0715048C013b69005231c476E43B |
| Skein Desk payer (buys verdicts on Telegraph) | 0x4d8dc7083f1edA89bec38070E8dAb5630a3e75f3 |
| Miner owner and fee address | see docs/guides/MINER_REGISTRATION.md |

All are controlled by the same team. Desk paying Skein is a consumer buying
from a provider the same team runs, and is reported as such, never as outside
demand.

## Video and audio

The demo film and teaser (`video/`) use Remotion (Remotion License: free for
individuals and companies of up to three people; larger teams need a company
license), Kokoro-82M (Apache 2.0) through kokoro-js for the narration,
faster-whisper (MIT) for word timings, and Mixkit music and sound effects
(Mixkit License, free for use in videos, not redistributed). The HTTP client
undici (MIT) is a dependency of the API.

