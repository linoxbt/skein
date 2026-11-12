# @skeinlabs/sdk

TypeScript client for [Skein](https://skeinlabs.site): one call returns a
listing verdict for an EVM token (**APPROVE**, **REJECT**, **ESCALATE** or
**ABSTAIN**), with reasons, open risks, cost and a hash anyone can recompute.

- `verdict()`, `quote()`, `verify()`, `stream()`, `bom()`, `submit()` / `wait()`
- typed errors (`SkeinError`, `SpendCapError`) carrying the API's codes
- retries that reuse the idempotency key, so a retried call is never charged twice
- a per-call spend cap, checked **before** any payment
- three ways to pay: a Skein partner key, per call through Telegraph escrow, or per call with x402
- every verdict signed by Skein, checkable offline with `@skeinlabs/sdk/attest`
- no runtime dependencies (the Telegraph and attest entries, and an x402 signing account, need `viem`)

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
    policy: "dex-list@0.2.0",
    context: { socialHandle: "project_handle", repoUrl: "https://github.com/org/repo" }, // optional: buys bot and code checks
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

No Skein account: each verdict is one paid Telegraph ask to Skein's miner
(`FRAUD_RISK_GENERAL`, catalogue id 845301), settled from your own escrow on
the Telegraph network.

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

The answer is used only if it comes from Skein's miner (845301, or its
registration id 5137, which receipts name) and is about the token, chain and
policy you asked for; anything else throws `TelegraphMismatchError`, whose
`payment` says what the ask cost. The Telegraph rail sends only the subject and
the policy: `context` is left out, and `payment.contextDropped` names the fields
that were (use the partner key or x402 for checks that need context). Payer
options: `minerId` (default `SKEIN_MINER_ID`), `intent` (default
`FRAUD_RISK_GENERAL`), `expectedMinerIds`, `routed: true` to let the network
pick the miner, and `strictContext: true` to refuse a request with context
before paying instead.

## Verdict (pay per call with x402)

The direct API also takes x402 (`exact` scheme, USDC on Base Sepolia): the SDK
reads the 402, signs one EIP-3009 transfer authorization and resends the
request with it. It signs nothing unless the terms name the network, payTo and
asset you pinned, at a price within your cap, and every retry resends the same
`X-PAYMENT`, so a retry never pays twice.

```ts
import { Skein } from "@skeinlabs/sdk";
import { privateKeyToAccount } from "viem/accounts";

const skein = new Skein({
  apiUrl: "https://api.skeinlabs.site",
  payer: {
    kind: "x402",
    account: privateKeyToAccount(process.env.PAYER_KEY as `0x${string}`), // a burner
    network: "base-sepolia",
    payTo: SKEIN_X402_PAY_TO, // pin Skein's address (from a 402 you checked once, or Skein's docs)
    maxUsdc: 0.3,
  },
});
const v = await skein.verdict({ subject: { chainId: 8453, token: "0x…" } });
console.log(v.payment); // { rail: "x402", amountUsdc, settled, network, payer, transaction }
```

An ABSTAIN is never settled (`settled: false`, `amountUsdc: 0`).

## Check Skein's signature yourself

Every verdict is signed by Skein (EIP-191) over its id, subject, outcome,
policy, verdict hash, receipts root and cost. The signer's address is published
at `https://api.skeinlabs.site/v1/status` (`attester`). The check rebuilds the
message from the verdict's own fields, so an edited verdict fails even with the
original signature attached:

```ts
import { verifyAttestation } from "@skeinlabs/sdk/attest";   // needs viem

const { attester } = await (await fetch("https://api.skeinlabs.site/v1/status")).json();
const check = await verifyAttestation(v, { signer: attester });
if (!check.ok) throw new Error(check.problems.join("; "));
```

Pin the attester address in your own config rather than fetching it on every call.

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
| `policies()` / `policy(ref)` | free | The published policies, or one by id or id@version |
| `status()` / `ledger()` | free | Network, wallet and cap alerts, the attester; the public spend ledger |
| `setWebhook(url)` / `webhook()` / `deleteWebhook()` | partner key | Get told when an async verdict is sealed; the secret is shown once |

`verifyWebhook(rawBody, req.headers, secret)` from `@skeinlabs/sdk/webhooks`
checks a delivery: `X-Skein-Signature` is an HMAC-SHA256 of
`${X-Skein-Timestamp}.${body}`, and a timestamp more than five minutes off is
refused, so a captured delivery cannot be replayed (constant-time, Web Crypto).
`{ allowLegacyBodyOnly: true }` also accepts the older body-only signature.
The full HTTP API is described at https://api.skeinlabs.site/v1/openapi.json.

Options: `apiUrl`, `payer`, `maxUsdcPerCall`, `retries` (2), `maxRetryWaitMs`
(10 s), `requestTimeoutMs` (15 s), `timeoutMs` (120 s), `fetch`.

Verdicts are risk evidence, not investment advice. Treat anything but
`APPROVE` as "do not proceed without a human".

## License

Apache-2.0
