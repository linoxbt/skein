# Owner steps

These steps need your own accounts, so only you can do them. Each takes
2 to 10 minutes. Do them in order. Steps 1 and 2 matter most.

All the code they depend on is already merged and deployed. Never paste a
token, key or webhook URL into a chat, an issue or a commit. Paste them only
into the settings page named in each step.

| # | Step | Why | Time |
|---|---|---|---|
| 1 | [Revoke the old npm token, publish 0.3.0](#1-revoke-the-old-npm-token-and-publish-030) | The old token was exposed; npm users get 0.2.0, which has no webhooks | 10 min |
| 2 | [Protect `main`](#2-protect-main) | No one, including an agent, can push untested code to production | 3 min |
| 3 | [Send alerts to Slack or Discord](#3-send-alerts-to-slack-or-discord) | You hear about a low wallet, a spend cap or a crash | 5 min |
| 4 | [Turn on error tracking (Sentry)](#4-turn-on-error-tracking-sentry) | Crashes arrive with a stack trace and the request id | 10 min |
| 5 | [Check Postgres backups](#5-check-postgres-backups) | Every paid receipt and partner key can be restored | 3 min |
| 6 | [Link both Netlify sites to the repo](#6-link-both-netlify-sites-to-the-repo) | Web and Desk redeploy on every merge, instead of by hand | 5 min |
| 7 | [Optional: pay for one verdict with x402](#7-optional-pay-for-one-verdict-with-x402) | Proves the payment settles on-chain, end to end | 10 min |

---

## 1. Revoke the old npm token and publish 0.3.0

**Revoke the token pasted in chat earlier**

1. Sign in at <https://www.npmjs.com/login>.
2. Click your avatar (top right), then **Access Tokens**. Or go straight to
   `https://www.npmjs.com/settings/<your-npm-username>/tokens`.
3. Find the token created for Skein (it was used to publish 0.2.0). Click
   **Delete** (the bin icon) and confirm.

**Create a new token**

4. On the same page, click **Generate New Token** → **Granular Access Token**.
5. Fill in:
   - **Token name:** `skein-github-release`
   - **Expiration:** 90 days (or the longest npm offers)
   - **Bypass two-factor authentication:** tick it if shown. The workflow
     cannot answer a 2FA prompt.
   - **Packages and scopes → Permissions:** *Read and write*
   - **Select packages:** *Only select packages and scopes* → choose the
     `@skeinlabs` scope
6. Click **Generate Token**. Copy it now, because npm shows it only once.
   Help: <https://docs.npmjs.com/creating-and-viewing-access-tokens>

**Give it to GitHub**

7. Open <https://github.com/linoxbt/skein/settings/secrets/actions/new>.
8. **Name:** `NPM_TOKEN`. **Secret:** paste the token. Click **Add secret**.
   If `NPM_TOKEN` already exists, open it from
   <https://github.com/linoxbt/skein/settings/secrets/actions> and click
   **Update** instead.

**Publish**

9. Open <https://github.com/linoxbt/skein/actions/workflows/release.yml>.
10. Click **Run workflow** (right side). Leave branch `main` and *dry_run*
    unticked. Click the green **Run workflow**.
11. Wait for the green tick (about 2 minutes). Then check:
    - <https://www.npmjs.com/package/@skeinlabs/sdk> shows **0.3.0**
    - <https://www.npmjs.com/package/@skeinlabs/mcp> shows **0.3.0**

If it fails with `E401` or `E403`, the token lacks write access to
`@skeinlabs` or needs the 2FA bypass: redo steps 4 to 8. Re-running is safe,
because versions already on npm are skipped.

---

## 2. Protect `main`

1. Open <https://github.com/linoxbt/skein/settings/branches>.
2. Click **Add classic branch protection rule**. If you only see
   **Add branch ruleset**, use that; the options have the same names.
3. **Branch name pattern:** `main`
4. Tick **Require status checks to pass before merging**, then:
   - tick **Require branches to be up to date before merging**;
   - in the search box type `check` and select it, then type `e2e` and
     select it. Both are jobs in `.github/workflows/ci.yml`. If they don't
     show up, they appear after one CI run on a pull request.
5. Tick **Require a pull request before merging**. Set **Required approvals**
   to 0, so changes still go through CI without waiting for a reviewer.
6. Leave **Do not allow bypassing the above settings** unticked, so you can
   still act in an emergency.
7. Click **Create** (or **Save changes**).

Railway already deploys only commits whose CI is green. This step stops
untested code reaching `main` in the first place.

---

## 3. Send alerts to Slack or Discord

Pick one.

**Slack**

1. Open <https://api.slack.com/apps?new_app=1> → **From scratch** → name it
   `Skein alerts` → choose your workspace → **Create App**.
2. In the left menu: **Incoming Webhooks** → switch **Activate Incoming
   Webhooks** on.
3. Click **Add New Webhook to Workspace**, choose a channel (for example
   `#skein-alerts`), then click **Allow**.
4. Copy the URL. It starts with `https://hooks.slack.com/services/`.
   Help: <https://api.slack.com/messaging/webhooks>

**Discord**

1. In your server: **Server Settings** → **Integrations** → **Webhooks** →
   **New Webhook**.
2. Name it `Skein alerts`, pick a channel, then click **Copy Webhook URL**.
   It starts with `https://discord.com/api/webhooks/`.
   Help: <https://support.discord.com/hc/en-us/articles/228383668>

**Set it on Railway**

5. Open the api service's variables:
   <https://railway.com/project/59c5fa5d-4a32-473d-bfa1-fdd4cfa36997/service/71ed3a9b-269b-484e-bba1-37ffde298910/variables>
6. Click **New Variable**. **Name:** `ALERT_WEBHOOK_URL`. **Value:** the URL.
   Click **Add**.
7. Click **Deploy** on the banner that appears, to apply staged changes.
8. Optionally, add the same variable on the sniper service:
   <https://railway.com/project/59c5fa5d-4a32-473d-bfa1-fdd4cfa36997/service/32bd2c63-a0a4-43ef-8a20-efc38cefebc1/variables>

You'll get one message per alert per hour. Alerts cover a low purchaser
escrow, the daily spend cap, and unhandled errors.

---

## 4. Turn on error tracking (Sentry)

1. Sign up at <https://sentry.io/signup/>. The free Developer plan is
   enough.
2. Create a project: **Projects** → **Create Project** → platform
   **Node.js** → name it `skein` → **Create Project**. Skip the SDK setup
   screens, because Skein has its own reporter (`packages/errors`).
3. Copy the DSN. Go to **Settings** → **Projects** → `skein` → **Client Keys
   (DSN)** and copy the value, which looks like
   `https://abc123@o123456.ingest.sentry.io/7654321`.
   Help: <https://docs.sentry.io/concepts/key-terms/dsn-explainer/>
4. Set `SENTRY_DSN` to that value in three places:
   - Railway api:
     <https://railway.com/project/59c5fa5d-4a32-473d-bfa1-fdd4cfa36997/service/71ed3a9b-269b-484e-bba1-37ffde298910/variables>
   - Railway sniper:
     <https://railway.com/project/59c5fa5d-4a32-473d-bfa1-fdd4cfa36997/service/32bd2c63-a0a4-43ef-8a20-efc38cefebc1/variables>
   - Netlify Desk: <https://app.netlify.com/projects/skein-desk/configuration/env>
     → **Add a variable** → **Add a single variable** → key `SENTRY_DSN` →
     **Create variable**. Then go to
     <https://app.netlify.com/projects/skein-desk/deploys> → **Trigger
     deploy** → **Deploy project**.
5. On Railway, click **Deploy** on each service's staged-changes banner.

Each event is tagged `skein-api`, `skein-desk` or `skein-sniper` and carries
the request id, which matches the `requestId` in the logs. The same error is
sent at most once a minute.

---

## 5. Check Postgres backups

1. Open the Postgres service's backups:
   <https://railway.com/project/59c5fa5d-4a32-473d-bfa1-fdd4cfa36997/service/504aba16-1ed4-4cdc-8031-f853418b9e6c/backups>.
   Or go to the project, click **Postgres**, then the **Backups** tab.
2. If there's no schedule, click **Edit schedule** and tick **Daily** (kept
   6 days) and **Weekly** (kept 27 days). If the tab asks for a plan upgrade,
   backups need a paid Railway plan; decide whether the receipts are worth it.
3. Click **Create backup** once now, so there is a backup before anything
   else changes.
4. Optional, and better: **Point-in-time recovery** restores to any minute
   in the last ~4 weeks. See <https://docs.railway.com/volumes/point-in-time-recovery>.

Docs: <https://docs.railway.com/volumes/backups>. A restore creates a new
volume and keeps the old one, so trying one is safe.

---

## 6. Link both Netlify sites to the repo

Do this once per site. The build settings are already in each app's
`netlify.toml`.

**skein-web (skeinlabs.site)**

1. Open <https://app.netlify.com/projects/skein-web/configuration/deploys>.
2. Under **Build settings** → **Repository**, click **Link repository**
   (or **Manage repository** → **Link to a different repository**).
3. Choose **GitHub**. If asked, authorize Netlify and give it access to
   `linoxbt/skein`.
4. Pick `linoxbt/skein`.
5. Set:
   - **Branch to deploy:** `main`
   - **Base directory:** `apps/web`
   - leave **Build command**, **Publish directory** and **Functions
     directory** as filled in (they come from `apps/web/netlify.toml`).
6. Click **Link** (or **Save**).

**skein-desk (desk.skeinlabs.site)**

7. Open <https://app.netlify.com/projects/skein-desk/configuration/deploys>
   and repeat steps 2 to 6 with **Base directory:** `apps/desk`.

**Check**

8. Open <https://app.netlify.com/projects/skein-web/deploys> and click
   **Trigger deploy** → **Deploy project**. It should finish green in about
   2 minutes. Do the same for skein-desk.
9. Open <https://skeinlabs.site> and <https://desk.skeinlabs.site>.

Keep the environment variables already on each site; linking doesn't change
them. From now on, every merge to `main` redeploys both sites.

---

## 7. Optional: pay for one verdict with x402

x402 is live on `POST https://api.skeinlabs.site/v1/verdicts`: 0.25 USDC on
Base Sepolia, paid to `X402_PAY_TO`, which is set to your wallet
`0x4EbCF8147a7F0715048C013b69005231c476E43B`. It has been tested with a fake
facilitator but not settled on-chain. To settle one for real:

1. Use a **separate test wallet**, never the purchaser key.
2. Get Base Sepolia USDC: <https://faucet.circle.com> → **Base Sepolia** →
   paste the test wallet's address → **Send 10 USDC**. No ETH is needed,
   because the facilitator pays the gas.
3. In an empty folder:
   ```sh
   npm init -y && npm install x402-fetch viem
   PAYER_KEY=0x<test wallet key> node --input-type=module -e '
   import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";
   import { privateKeyToAccount } from "viem/accounts";
   const pay = wrapFetchWithPayment(fetch, privateKeyToAccount(process.env.PAYER_KEY), 250000n);
   const res = await pay("https://api.skeinlabs.site/v1/verdicts", { method: "POST",
     headers: { "content-type": "application/json" },
     body: JSON.stringify({ subject: { chainId: 8453, token: "0x4200000000000000000000000000000000000006" } }) });
   console.log(res.status, decodeXPaymentResponse(res.headers.get("x-payment-response")));
   console.log(JSON.stringify(await res.json()).slice(0, 400));'
   ```
4. Expect `200`, a transaction hash, and the verdict. Open the hash on
   <https://sepolia.basescan.org> to see 0.25 USDC move to your wallet.

To change where payments go, set `X402_PAY_TO` on the api service. To turn
x402 off, delete it. Partner keys are unaffected either way.
