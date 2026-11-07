# Guide 2 · Registering Skein as a Telegraph miner

> **Done, 2026-11-07.** Skein is registered and active: registration **5137**,
> catalogue id **845301**, slug `skein-listing-verdict`, intent
> `FRAUD_RISK_GENERAL`, minimum price 0.25 USDC. It was registered from a
> computer (the path at the end of this guide) by the owner wallet
> `0x4EbCF8147a7F0715048C013b69005231c476E43B`, which is also the fee address.
> Its key is `MINER_REGISTRATION_KEY` in `skein-secrets.md`: keep it, because
> only that wallet can update or deregister the miner or rotate its API key.
> The bond was $1, taken as 0.154 MACHINA (MACHINA was about $6.50 that day,
> so 2 USDC bought 0.31 MACHINA, not the 1.3 this guide estimated).
> `SKEIN_SELF_REGISTRATION_IDS=845301,5137` is set on Railway. Check it any time:
> `https://devnode.telegraphprotocol.com/api/miners/5137`.

**Time:** about 30 minutes, plus a 10 to 15 minute wait. **Cost:** a little
Sepolia ETH for gas and about 1.3 MACHINA for a bond that is returned if you
ever deregister. **Before you start:** finish guide 1 (the purchaser wallet).
Without it the miner registers fine, but answers every request with ABSTAIN.

Sources: Telegraph's own docs, now at **anjoman.ai/docs**. The old
docs.telegraphprotocol.com redirects there. The pages behind this guide are
"Registering as a Miner", "YAML Configuration" and "Addresses & Parameters"
(read 2026-11-04).

## What registration does

Today apps reach Skein through its API with a partner key. Registering makes
Skein a **miner** on the Telegraph network too, so any Telegraph app or agent
can buy a verdict with one paid ask, with no account and no key. Skein earns
MACHINA for each answer. This is what the Providers track measures, and what
section 09 of the tutorial (skeinlabs.site/tutorial#telegraph) describes.

Registration is permissionless: no one approves it. After you send it, Telegraph
nodes fetch the YAML, check its hash, validate it and start routing to Skein.

## The decision: plan A or plan B

A miner must serve **canonical** intents, the question types the network has approved.

| | Intent | Status (checked on-chain 2026-11-04) | What Skein answers |
|---|---|---|---|
| Plan A | `FRAUD_RISK_TOKEN_LISTING` | **Not canonical.** Proposed in `miner/INTENT_PROPOSAL.md`, not approved | The full verdict, as its own intent |
| **Plan B** | `FRAUD_RISK_GENERAL` | **Canonical**, 11 live miners (IP, URL and payment fraud feeds) | A risk level (LOW, MEDIUM, HIGH, CRITICAL), a score from 0 to 1, the signals, a summary, and the full verdict alongside |

**Recommendation: plan B now.** It can go live today. Skein would be the only
miner in that intent that assesses EVM tokens, and the YAML's description says
so, which steers token questions to Skein. If plan A is approved later, one
`updateMiner` transaction adds it with no new registration.

The plan-B file is ready: **`miner/skein-miner.plan-b.yaml`**
(https://github.com/linoxbt/skein/blob/main/miner/skein-miner.plan-b.yaml).
It uses id `845301` and slug `skein-listing-verdict`, both unused on the
network as of today. It passes every check Telegraph documents:

```sh
npx tsx miner/check-yaml.ts miner/skein-miner.plan-b.yaml
# intent FRAUD_RISK_GENERAL: canonical=true
# id 845301 / slug skein-listing-verdict: 0 live miners use them (0 = free)
# all checks passed
```

How Skein maps a verdict to plan B's risk level: APPROVE → LOW; ESCALATE and
ABSTAIN → MEDIUM; REJECT → HIGH; REJECT by a hard blocker (a sanctions hit, a
critical audit failure) → CRITICAL.

## The two keys involved, and which is which

| | What it is | Where it lives |
|---|---|---|
| **Owner wallet** | The wallet that sends the registration. Only it can update or deregister the miner, or change its API key. Its address also receives the MACHINA payouts | Your MetaMask. Keep its recovery phrase safe |
| **`MINER_AUTH_KEY`** | A shared secret. Telegraph presents it to Skein's API on every request (header `X-Skein-Miner-Key`), so only Telegraph can call the miner endpoint | Railway (variable), and installed with Telegraph against the slug. **Never** in the YAML |

I generated `MINER_AUTH_KEY` for you. It is in **`skein-secrets.md`**.

---

## Step by step (phone, with the registration interface)

Telegraph's own interface at **anjoman.ai/dashboard/earn** does the whole thing:
it validates the YAML, sandbox-tests Skein's real endpoint, pins the YAML to
IPFS, sends the transaction from your wallet and installs the API key.

### 1. Turn on Skein's miner endpoint (Railway)

1. Copy the `MINER_AUTH_KEY` value from `skein-secrets.md`.
2. railway.com → project **skein** → service **api** → **Variables** → **New Variable**:
   name `MINER_AUTH_KEY`, value: paste. Then tap **Deploy**.
3. Tell me, and I'll confirm that the endpoint went from "not configured"
   (HTTP 503) to "needs the key" (HTTP 401). That 401 is correct: only Telegraph has the key.

### 2. Get a wallet ready: Sepolia ETH and about 1.3 MACHINA

1. Install **MetaMask** on your phone if you don't have it. Create or pick an
   account: this becomes the miner's **owner wallet**.
2. Turn on test networks (Settings → Advanced → Show test networks) and switch to **Sepolia**.
3. Get Sepolia ETH into it from the faucet in guide 1 (step A1), using **this**
   wallet's address. 0.02 ETH is plenty.
4. MACHINA for the bond: the bond is $1 for the first intent, taken in MACHINA
   at the pool price (about 1.3 MACHINA today). **Send me your wallet address**
   (it's public, safe to share) and I'll send 2 MACHINA from the project wallet.
   Or do it yourself on a computer:
   `npx tsx miner/tools.ts mint-usdc 3 --as registration --yes` then `swap-machina 2 --yes`.

### 3. Open the registration interface inside MetaMask

1. In MetaMask, open the **Browser** tab (the globe icon).
2. Go to **anjoman.ai/dashboard/earn** and tap **Connect wallet**. Approve, on Sepolia.

### 4. Paste the YAML and the key, then validate

1. Paste the whole of `miner/skein-miner.plan-b.yaml`. (Open the GitHub link
   above, tap **Raw**, select all, copy.)
2. When it asks for an **API key**, paste the `MINER_AUTH_KEY` value: the same
   one you put in Railway.
3. Run the validation. You want:
   - the schema check passing;
   - the `/verdict` endpoint test passing, with `auth_applied` showing a masked
     `X-Skein-Miner-Key`;
   - warnings, if any, are fine (they never block registration).

   If the endpoint test fails with 401, the key in Railway and the key you
   pasted differ, or Railway hasn't deployed yet.

### 5. Register

1. It asks for a **fee address**: use your owner wallet's address (or a
   separate address you control). MACHINA payouts go there.
2. **Minimum price**: `0.25` USDC (250000 in 6-decimal units). Skein's list
   price, and what `miner/skein-miner.yaml` assumes.
3. Confirm the transactions MetaMask shows: first the MACHINA **approve** (the
   bond), then **registerMiner**.
4. Copy the **registration id** it shows (or the transaction link).

### 6. Wait for activation, then send me the id

Nodes read the chain about 10 to 15 minutes behind, so activation takes that long. Check:

```
https://devnode.telegraphprotocol.com/api/miners/<registrationId>
```

`activation_status: "active"` means Skein is live. Then send me the
registration id and I will:

- set `SKEIN_SELF_REGISTRATION_IDS` on Railway. **This step is required:** it
  stops Skein ever buying from itself, which would loop;
- pin `SKEIN_MINER_ID` for the Desk, the SDK examples and the MCP docs;
- update the tutorial's "status: registration pending" note;
- buy one verdict through Telegraph end to end, and send you the receipt.

For the first 7 days Skein is in the **grace period**: it receives a share of
5% of the intent's traffic while it builds a track record, and then competes on
the leaderboard.

---

## Alternative: from a computer, with `cast` or `miner/tools.ts`

The interface is the only path that installs the API key for you. By hand, you
register first and then install the key with a signed challenge (see "Installing
or rotating your API key" in Telegraph's registration docs).

```sh
export MINER_REGISTRATION_KEY=0x…   # the owner wallet's key (keep it cold)
npx tsx miner/check-yaml.ts miner/skein-miner.plan-b.yaml
npx tsx miner/tools.ts mint-usdc 3 --as registration --yes
npx tsx miner/tools.ts swap-machina 2 --yes
npx tsx miner/tools.ts approve-bond 5 --yes
npx tsx miner/tools.ts register \
  --yaml-url https://raw.githubusercontent.com/linoxbt/skein/main/miner/skein-miner.plan-b.yaml \
  --fee-address 0x<your payout address> --min-price-usdc 0.25 --intent FRAUD_RISK_GENERAL --yes
# once https://devnode.telegraphprotocol.com/api/miners/<registrationId> says "active":
MINER_AUTH_KEY=… npx tsx miner/tools.ts install-key skein-listing-verdict --yes
```

`install-key` asks the node for a challenge naming the key's keccak256
fingerprint, checks that the challenge names this wallet and this key, signs it
with the owner wallet and submits the key. The node sandbox-tests it before
storing it. Its test of `/verdict` reports 404 and counts as a pass: it probes
the path Telegraph exposes, not the `external_path` (`/miner/verdict`) that real
asks are forwarded to. A paid ask is the real test.

`register` fetches the YAML from that URL and hashes the bytes it serves, so
the hash always matches. Never edit the file at that URL after registering:
change it only with `updateMiner`.

## If something goes wrong

| Symptom | Cause and fix |
|---|---|
| `MinerRegistryFacet: unsupported intent` | The intent isn't canonical. Plan B's is; check with `npx tsx miner/tools.ts check-intent FRAUD_RISK_GENERAL` |
| `ERC20InsufficientAllowance` or `ERC20InsufficientBalance` | Not enough MACHINA, or the bond wasn't approved first |
| Stuck in `pending` or missing from `/api/miners` | Wait 15 minutes, then read `/api/miners/<registrationId>`: `rejection_reason` says why |
| `rejected` with "YAML id … already in use" or a slug clash | Someone took the id or slug: change it in the YAML, rerun `check-yaml.ts`, then `updateMiner` |
| `rejected` with "Hash mismatch" | The bytes served differ from what was hashed (often a trailing newline). The interface and `tools.ts register` both hash what is served |
| Requests fail with 401 after going live | The key installed with Telegraph differs from `MINER_AUTH_KEY` in Railway: reinstall it from the interface |
| Every answer is MEDIUM with an ABSTAIN verdict | Guide 1 isn't done: the purchaser wallet isn't funded |

To withdraw later: `deregisterMiner(<registrationId>)` from the owner wallet
returns the bond, which you can withdraw two days later with `withdrawMinerBond()`.
