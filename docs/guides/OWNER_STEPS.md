# Owner steps

Almost everything is set up. These steps need you: they write secrets or
need your two-factor code, which the build tools are not allowed to do.

## Needed

1. **Turn on Skein Desk's Telegraph rail** (the Apps-track autonomous
   purchase). On Netlify, site **skein-desk** → Site configuration →
   Environment variables, add:
   - `DESK_PAYER` = `telegraph`
   - `DESK_PAYER_KEY` = the Desk wallet's private key (secret; from the file
     handed to you, wallet 0x4d8dc7083f1edA89bec38070E8dAb5630a3e75f3, which
     already holds 20 test USDC in Telegraph escrow)
   - `SKEIN_MINER_ID` = `845301`

   Then **Deploys → Trigger deploy**. The board at desk.skeinlabs.site shows
   `rail: telegraph`, and within a day decisions carry Telegraph receipts.
2. **Encrypt webhook secrets at rest.** On the Railway
   [api service's variables](https://railway.com/project/59c5fa5d-4a32-473d-bfa1-fdd4cfa36997/service/71ed3a9b-269b-484e-bba1-37ffde298910/variables),
   add `WEBHOOK_SECRET_KEY` (secret; 32 random bytes as hex, from the file
   handed to you).
3. **Keep the backup key offline.** Backups are now encrypted to an age key.
   Save the identity file handed to you somewhere safe and offline (a password
   manager). Without it no backup can be restored.
4. **Rotate the Skein Sniper partner key** that was exposed in a build log:
   from a checkout run `node scripts/issue-partner-key.mjs sniper agent 2 ./sniper.key`
   (`*.key` files are ignored by git). Append the line it prints to
   `SEED_CONSUMERS` on the Railway api service, set the key in `sniper.key` as
   `SNIPER_SKEIN_KEY` on the sniper service, and add the old key's hash to
   `REVOKED_KEY_HASHES` on the api service.
5. **Approve the 0.3.1 release on npm** once it is published by the release
   workflow: <https://www.npmjs.com/package/@skeinlabs/sdk> → **Staged
   Packages** → **Approve**, then the same for `@skeinlabs/mcp` (SDK first).
6. **Protect `main`:** <https://github.com/linoxbt/skein/settings/branches> →
   **Add classic branch protection rule** → pattern `main` → **Require status
   checks to pass** → add `check`, `e2e` and `loadtest` → **Create**.
7. **Fill in the Team / contact line** of docs/SUBMISSION.md before submitting.

## Already done for you

| What | How |
|---|---|
| Postgres backups | A `backup` service on Railway runs `pg_dump` nightly (03:17 UTC), encrypts it to the age key, and uploads it to the private bucket `skein-backups`, keeping 30. `restore-drill.sh` proves a dump restores. Railway's own backup schedules need a Pro workspace. |
| Alerts | The Railway probe (every 10 min) pushes alerts, and the GitHub uptime workflow (GitHub runs it hours apart, not every 15 min) opens a GitHub issue labelled `alert` and @-mentions you when anything fails. That covers API, database, purchaser escrow, spend cap, unhandled errors, web, Desk, sniper and the Telegraph miner. The issue closes itself on recovery. You get these in the GitHub app and by email, with no webhook to set up. |
| Error tracking | Every unhandled API error is kept for 30 days in the `error_log` table with its stack and request id, and `/v1/status` shows `errorsLastHour`. Errors also trigger the alert above. |
| Netlify | skein-web and skein-desk are linked to `linoxbt/skein`, branch `main` (base `apps/web` and `apps/desk`). Every merge redeploys both. |
| Deploy safety | Railway deploys the API and sniper only after CI is green on `main`. |
| x402 | Live on `POST /v1/verdicts`, paying 0.25 USDC (Base Sepolia) to your wallet `0x4EbCF8147a7F0715048C013b69005231c476E43B`. |

## Optional extras

None of these is required.

- **Slack or Discord pings as well as GitHub issues.** Create an incoming
  webhook ([Slack](https://api.slack.com/messaging/webhooks) or
  [Discord](https://support.discord.com/hc/en-us/articles/228383668)). Add it
  as `ALERT_WEBHOOK_URL` on the
  [api service's variables](https://railway.com/project/59c5fa5d-4a32-473d-bfa1-fdd4cfa36997/service/71ed3a9b-269b-484e-bba1-37ffde298910/variables).
- **Sentry, as well as the built-in error log.** Sign up at
  <https://sentry.io/signup/>, create a Node.js project, and copy its DSN
  (Settings → Projects → Client Keys). Add it as `SENTRY_DSN` on the same
  variables page.
- **npm trusted publishing.** On npmjs.com, each package → Settings →
  Trusted publishing → GitHub Actions: repository `linoxbt/skein`, workflow
  `release.yml`, environment `npm`. Then `NPM_TOKEN` can be deleted. Adding
  yourself as a required reviewer on the `npm` environment (GitHub → Settings
  → Environments) gates every publish.
- **Railway volume backups too.** These need a Pro workspace. If you upgrade,
  open the Postgres service → **Backups** and tick Daily and Weekly.
