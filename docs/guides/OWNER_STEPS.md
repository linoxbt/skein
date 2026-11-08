# Owner steps

Almost everything is set up. One step needs you, because npm requires your
two-factor code.

## Needed: approve the 0.3.0 release on npm (2 clicks each)

`@skeinlabs/sdk` and `@skeinlabs/mcp` 0.3.0 are uploaded and waiting.
npm holds every token-published version until a person approves it with 2FA.

1. Open <https://www.npmjs.com/package/@skeinlabs/sdk>, signed in as
   `lunexfinance`. Open the **Staged Packages** tab, click **Approve** on
   0.3.0, and enter your 2FA code.
2. Do the same at <https://www.npmjs.com/package/@skeinlabs/mcp>. Approve the
   SDK first, because the MCP server depends on it.

Or from a terminal: `npm stage list @skeinlabs/sdk`, then
`npm stage approve <stage-id>`. This needs npm 11.15 or later.

## Already done for you

| What | How |
|---|---|
| Postgres backups | A `backup` service on Railway runs `pg_dump` nightly (03:17 UTC) into the private bucket `skein-backups`, keeping 30. Railway's own backup schedules need a Pro workspace. |
| Alerts | The uptime probe (every 15 min) opens a GitHub issue labelled `alert` and @-mentions you when anything fails. That covers API, database, purchaser escrow, spend cap, unhandled errors, web, Desk, sniper and the Telegraph miner. The issue closes itself on recovery. You get these in the GitHub app and by email, with no webhook to set up. |
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
- **Branch protection.** Railway already refuses to deploy red builds. To
  also stop red code reaching `main`: open
  <https://github.com/linoxbt/skein/settings/branches> → **Add classic branch
  protection rule** → pattern `main` → tick **Require status checks to pass**
  → add `check` and `e2e` → **Create**.
- **Railway volume backups too.** These need a Pro workspace. If you upgrade,
  open the Postgres service → **Backups** and tick Daily and Weekly.
