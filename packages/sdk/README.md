# @skeinlabs/sdk

TypeScript client for [Skein](https://skeinlabs.site): one call returns a
listing verdict for an EVM token (**APPROVE**, **REJECT**, **ESCALATE** or
**ABSTAIN**), with reasons, open risks, cost and a hash anyone can recompute.

- `verdict()`, `quote()`, `verify()`, `stream()`, `bom()`, `submit()` / `wait()`
- typed errors (`SkeinError`, `SpendCapError`) carrying the API's codes
- retries that reuse the idempotency key, so a retried call is never charged twice
- a per-call spend cap, checked **before** any payment
- two ways to pay: a Skein partner key, or per call through Telegraph escrow
- no runtime dependencies (the Telegraph entry needs `viem`)

**[Read the full tutorial →](https://skeinlabs.site/tutorial)**

## Install

```sh
npm install @skeinlabs/sdk
# for the Telegraph rail, also:
npm install viem
```

Node 20 or later, or any runtime with `fetch` (Bun, Deno, edge workers, browsers).

## Quote (free, no key)

```ts
import { Skein } from "@skeinlabs/sdk";

const skein = new Skein({ apiUrl: "https://api.skeinlabs.site" });
const q = await skein.quote({ subject: { chainId: 8453, token: "0x4200000000000000000000000000000000000006" } });
console.log(q.priceUsdc, q.checks?.map((c) => c.check));
```

## Verdict (partner key)

```ts
import { Skein, SkeinError, SpendCapError } from "@skeinlabs/sdk";

const skein = new Skein({
  apiUrl: "https://api.skeinlabs.site",
  payer: { kind: "apiKey", key: process.env.SKEIN_API_KEY! },
  maxUsdcPerCall: 0.3, // refused before paying above this
});

try {
  const v = await skein.verdict({
    subject: { chainId: 8453, token: "0x…" },
    policy: "dex-list@0.1.0",
    onEvent: (e) => console.log(e.type), // plan, purchase, finding, decision, done
  });
  if (v.verdict !== "APPROVE") console.log("needs a human:", v.reasons.map((r) => r.detail));
  const report = await skein.verify(v.id); // recompute it from the raw paid answers
  console.log(report.ok ? "verified" : report.problems);
} catch (e) {
  if (e instanceof SpendCapError) console.log(`quoted ${e.priceUsdc} USDC, cap ${e.capUsdc}`);
  else if (e instanceof SkeinError) console.log(e.code, e.message);
  else throw e;
}
```

## Verdict (pay per call through Telegraph)

No Skein account: each verdict is one paid Telegraph ask, settled from your
own escrow on the Telegraph network.

```ts
import { Skein } from "@skeinlabs/sdk";
import { TelegraphClient, TESTNET, viemSigner } from "@skeinlabs/sdk/telegraph";

const client = new TelegraphClient({
  network: TESTNET, // Sepolia escrow
  signer: viemSigner(process.env.PAYER_KEY as `0x${string}`), // a burner, never a treasury key
  maxUusdcPerCall: 300_000, // 0.30 USDC: no 402 challenge is signed above this
});
const skein = new Skein({ apiUrl: "https://api.skeinlabs.site", payer: { kind: "telegraph", client } });
const v = await skein.verdict({ subject: { chainId: 1, token: "0x…" } });
console.log(v.verdict, v.payment); // { rail: "telegraph", minerId, amountUsdc, receiptHash, signalHash }
```

## API

| Method | Cost | What it does |
|---|---|---|
| `quote({ subject, policy? })` | free | What a verdict would buy and cost, or why it would be refused |
| `verdict(req)` | paid | Buys one verdict and resolves once it is sealed |
| `submit(req)` / `wait(id)` | paid | The same in two steps, for queues and long-running jobs |
| `get(id)` | free | A stored verdict, or `{ status: "running" }` |
| `stream(id)` | free | The verdict's live events as an async iterator |
| `bom(id)` | free | The bill of materials: every paid input and its receipt |
| `verify(id)` | free | Recomputes the verdict hash and the receipts' Merkle root |

Options: `apiUrl`, `payer`, `maxUsdcPerCall`, `retries` (2), `maxRetryWaitMs`
(10 s), `requestTimeoutMs` (15 s), `timeoutMs` (120 s), `fetch`.

Verdicts are risk evidence, not investment advice. Treat anything but
`APPROVE` as "do not proceed without a human".

## License

Apache-2.0
