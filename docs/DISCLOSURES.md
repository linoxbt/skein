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

No personal data is collected. The Desk's form takes a project name, a token
and optional public handles; it does not ask for contact details. Verdicts are
public by id, by design: anyone can verify any verdict.

## Accuracy

- Every screen labels the network. Simulated data is labelled as such
  wherever it appears.
- Nothing from before the event period (Nov 1, 2026 UTC) is presented as event
  activity: the client refuses paid calls before it.
- The benchmark harness (eval/) is built; the labelled set is curated by hand
  and reported only once it exists. No result is claimed before then.
