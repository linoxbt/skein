# Guide 1 · The purchaser wallet (`PURCHASER_PRIVATE_KEY`)

**Time:** about 15 minutes. **Cost:** nothing (test tokens). **Do this first:** guides 2 and 3 depend on it.

## What it is, and why every verdict says ABSTAIN today

A verdict is made from six checks (contract audit, sanctions, holders,
liquidity, wash trading, social bots) that Skein **buys** from other miners on
the Telegraph network. It pays for them from a Telegraph **escrow** account, and
the key that signs those payments is `PURCHASER_PRIVATE_KEY`, a variable on the
API service in Railway.

It is not set yet, so every purchase fails and every verdict is ABSTAIN. That is
the right behaviour (no evidence, no decision, nothing charged), and it is what
the SDK and MCP screenshots show. Once this wallet is funded, verdicts become
APPROVE, REJECT or ESCALATE.

Everything here is on the **Sepolia testnet**: the ETH and USDC are free test
tokens with no value. The API also caps its own spending: at most 0.05 USDC per
purchase, 0.20 USDC per verdict and 10 USDC per day (`MAX_USDC_PER_CALL`,
`PER_VERDICT_CAP_USDC`, `DAILY_CAP_USDC` in Railway).

**How much to fund:** one verdict costs about 0.06 USDC upstream. 15 USDC in
escrow covers about 250 verdicts, which is enough for the 90-token evaluation
(guide 3) several times over.

## Pick a path

| | Path A, from your phone (recommended) | Path B, on a computer |
|---|---|---|
| Wallet | The burner I already created: `0xC14B8719F49165Ab34E741B441Ca3c6720dd6c8a` | One you create yourself |
| You do | Get free Sepolia ETH into it, paste one value into Railway | Every step, with the commands below |
| I do | Mint the test USDC and deposit it into escrow | Nothing (or I check your work) |

---

## Path A · From your phone

### A1. Get free Sepolia ETH into the burner (gas for two transactions)

1. Open **https://cloud.google.com/application/web3/faucet/ethereum/sepolia** and sign in with a Google account.
2. Paste the burner address: `0xC14B8719F49165Ab34E741B441Ca3c6720dd6c8a`
3. Tap **Receive 0.05 Sepolia ETH**.

If that faucet refuses, any Sepolia faucet works (search "Sepolia faucet").
0.01 ETH is enough. You can check it arrived at
`https://sepolia.etherscan.io/address/0xC14B8719F49165Ab34E741B441Ca3c6720dd6c8a`.

### A2. Tell me it is funded

Send me a message: "the burner has Sepolia ETH". I then run, from this repo:

```sh
npx tsx miner/tools.ts mint-usdc 20 --yes     # mint 20 test USDC to the burner
npx tsx miner/tools.ts deposit 15 --yes       # approve the escrow, deposit 15 USDC
npx tsx miner/tools.ts status                 # escrowEffectiveUsdc should read 15
```

and send you the transaction links.

### A3. Put the key into Railway

1. Open the file **`skein-secrets.md`** I sent you. Copy the value under **PURCHASER_PRIVATE_KEY** (starts with `0x`, 66 characters).
2. Open **https://railway.com** → project **skein** → service **api** → **Variables** → **New Variable**.
3. Name `PURCHASER_PRIVATE_KEY`, value: paste. Tick it as a secret if offered.
4. Railway shows the change as staged: tap **Deploy** (or "Apply changes").

### A4. Check it worked

- **https://skeinlabs.site/status**: the "purchaser wallet" line shows `0xC14B…6c8a` instead of "not configured".
- Or open **https://api.skeinlabs.site/v1/status**: `"payer"` is no longer `null`.
- Run a verdict in the **console** (skeinlabs.site/console) for WETH on Base
  (`0x4200000000000000000000000000000000000006`). You should now see six
  purchases with receipts, and a verdict that is not ABSTAIN.

Tell me when it's in and I'll run the same check from here.

---

## Path B · On a computer (your own wallet)

You need Node.js 20+ and this repo (`git clone https://github.com/linoxbt/skein && cd skein && pnpm install`).

```sh
# 1. A new wallet, used only for this. Either:
cast wallet new                          # Foundry, or
(cd miner && node -e 'const{generatePrivateKey,privateKeyToAccount}=require("viem/accounts");const k=generatePrivateKey();console.log(k, privateKeyToAccount(k).address)')

export PURCHASER_PRIVATE_KEY=0x…         # keep it out of your shell history if you can

# 2. Sepolia ETH: send some to the address from step 1 (faucet above)

# 3. Test USDC and the escrow deposit
npx tsx miner/tools.ts mint-usdc 20      # simulates first: read it, then add --yes
npx tsx miner/tools.ts mint-usdc 20 --yes
npx tsx miner/tools.ts deposit 15 --yes
npx tsx miner/tools.ts status            # escrowEffectiveUsdc: 15
```

Then do A3 and A4 with your key instead of the burner's.

## If something goes wrong

| Symptom | Cause and fix |
|---|---|
| `insufficient funds for gas` | The wallet has no Sepolia ETH yet. Do A1 again and wait a minute |
| `status` shows wallet USDC but escrow 0 | The deposit step was not sent: run `deposit 15 --yes` |
| `/v1/status` still says `"payer": null` | The Railway variable is staged but not deployed: tap Deploy |
| Verdicts still ABSTAIN with "UPSTREAM_UNAVAILABLE" | A required check has no live miner right now; see the status page |
| `DAILY_CAP_REACHED` | The API spent its 10 USDC for the day; raise `DAILY_CAP_USDC` in Railway if you need more |

**Safety:** this key can only spend what is in its escrow, and the escrow holds
test USDC. Never reuse this wallet for anything of value. To rotate it, make a
new wallet, fund it, replace the Railway variable, and deploy.
