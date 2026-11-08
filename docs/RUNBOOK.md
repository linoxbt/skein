# Skein runbook

What to do when something breaks, and how to ship, roll back and rotate. Each
entry gives the symptom, how to confirm it, and the fix.

## Where everything runs

| Service | Host | URL | Health check |
|---|---|---|---|
| API and miner endpoint | Railway, project `skein`, service `api` | https://api.skeinlabs.site | `GET /healthz` (process up), `GET /readyz` (database reachable), `GET /v1/status` (wallet, caps, miners) |
| Postgres | Railway, same project | internal | via `/readyz` |
| Sniper (Mission 14) | Railway, service `sniper` | https://sniper-production-bea6.up.railway.app | `GET /healthz`, `GET /feed.json` |
| Web site | Netlify, site `skein-web` | https://skeinlabs.site | `GET /status` (the page reads the API) |
| Skein Desk | Netlify, site `skein-desk` | https://desk.skeinlabs.site | `GET /api/applications` returns 200 JSON |
| Telegraph miner | registration 5137, catalogue id 845301 | `GET https://devnode.telegraphprotocol.com/api/miners/5137` | `activation_status: "active"` |

**Alerts.** Set `ALERT_WEBHOOK_URL` on the Railway `api` service to a Slack or
Discord webhook. The API posts there, at most once per condition every six hours, when:
- the purchaser wallet drops below `HOT_WALLET_ALERT_USDC`;
- the day's upstream spend reaches 80% of `DAILY_CAP_USDC`;
- verdict runs are marked lost;
- a request fails with an unhandled error. The alert carries the request id.

Without the variable, alerts go to the Railway log only.

**Uptime.** `.github/workflows/uptime.yml` probes every service every 15
minutes from GitHub. It fails the run, and GitHub emails the repository owner,
when any of these happen:
- the API, its database, the web site, the Desk queue or the sniper stops answering;
- an unknown verdict stops returning 404;
- `/v1/status` shows a wallet or cap alert;
- Telegraph registration 5137 is no longer `active`.

The Actions tab keeps the history. Run it by hand with "Run workflow".

**Logs.** Railway service → Deployments → View logs. The API writes one JSON
line per request, carrying the `requestId` that is also sent in every error
body and in the `X-Request-Id` header. Search the log for an id a user reports.
Netlify logs are under the site → Logs → Functions, or Observability.

## Incidents

### The Desk shows "Loading…" or an error banner; `/api/applications` returns 503 STORE_UNAVAILABLE

- **Cause:** the Desk's store did not answer. Since 2026-11-08 the store is
  Skein's own API (`/v1/kv`, DECISIONS L29), so this means the API is down or
  refusing the Desk's key.
- **Confirm:** the Desk's function log shows `store get …: HTTP <status>`.
  - 403: the Desk key's SHA-256 is missing from `KV_KEY_HASHES` on Railway.
  - 5xx or a timeout: the API itself is down (see "The API is down").
- **Fix:** restore the API, or add the hash back to `KV_KEY_HASHES`. If the
  store must move off the API in a hurry, set `DESK_STORE=blobs` on Netlify and
  redeploy. Netlify Blobs was unreliable from the functions, which is why it
  was replaced.

### Every verdict is ABSTAIN with `purchase_failed`; `/v1/status` shows `walletAlert: true`

- **Cause:** the purchaser wallet's Telegraph escrow is empty.
- **Fix:** refill it, as in `docs/guides/PURCHASER_KEY.md`:
  1. Mint test USDC.
  2. Run `PURCHASER_PRIVATE_KEY=… npx tsx miner/tools.ts deposit <usdc> --yes`.
  3. Check with `npx tsx miner/tools.ts status`.

  Nodes see a deposit about 10–15 minutes after it is mined. Until then,
  payments are refused with `available=0`.

### Verdicts answer 503 DAILY_CAP_REACHED

- **Cause:** the day's upstream spend reached `DAILY_CAP_USDC`. This is by design.
- **Fix:** it resets at 00:00 UTC. Raise the cap only on purpose: change
  `DAILY_CAP_USDC` on Railway, which redeploys the API.

### A check keeps coming back ERROR or UNKNOWN

1. Read the verdict's bill of materials: `GET /v1/verdicts/{id}/bom` (public)
   shows each purchase's miner, HTTP status and error.
2. Read the miner's actual answer on the node:
   `GET https://devnode.telegraphprotocol.com/engine/v1/signal/{signalHash}`.
3. If a miner is down or wrong, the allowlist in
   `packages/telegraph/src/allowlist.ts` orders the fallbacks. A paid but
   unusable answer already buys the next allowlisted miner (DECISIONS L24).

### The API is down (`/healthz` fails)

1. Railway → `api` → Deployments: if the latest deploy failed, open its build log.
2. Roll back (below) while you fix it.
3. If the deploy is fine but `/readyz` fails, check the Postgres service.

### x402 callers get 402 "could not be settled" or "facilitator refused"

The facilitator (`X402_FACILITATOR_URL`) refused or did not answer. Look for
`x402 settlement failed` in the API logs. A verdict whose settlement failed is
kept: the caller's retry with the same `X-PAYMENT` settles and delivers it
without buying again. To switch x402 off, unset `X402_PAY_TO` and redeploy;
partner keys are unaffected. Settled payments are `revenue_settled` rows in
`spend_ledger` (ref `x402:<run>:<transaction>`).

### Telegraph asks to Skein fail with 401

The key Telegraph holds differs from `MINER_AUTH_KEY` on Railway. Reinstall it
with the owner wallet:
`MINER_REGISTRATION_KEY=… MINER_AUTH_KEY=… npx tsx miner/tools.ts install-key skein-listing-verdict --yes`.

## Deploying

- **API and sniper (Railway)** deploy from `main`, and only after GitHub
  reports CI green on the commit (Railway's "wait for CI", `checkSuites`, set
  2026-11-08). A red build never reaches production. Each service builds from
  its own Dockerfile path (`RAILWAY_DOCKERFILE_PATH`). Database migrations run
  at start, under an advisory lock, so two instances never race.
- **Web and Desk (Netlify).** `apps/web/netlify.toml` and `apps/desk/netlify.toml`
  build from the repository with pnpm. To switch from manual uploads to a
  deploy on every push:
  1. Netlify → site → Site configuration → Build & deploy → Link repository.
  2. Choose `linoxbt/skein`, branch `main`.
  3. Set Base directory to `apps/web` (or `apps/desk`). The rest comes from `netlify.toml`.
  4. Keep the environment variables already set on the site.

  Until then, deploy by uploading the app with Netlify's CLI or MCP from a
  checkout of `main`.

## Rolling back

- **Railway:** service → Deployments → the last good deploy → Redeploy. It is
  live in about a minute. Rolling back does not touch the database.
- **Netlify:** site → Deploys → the last good deploy → Publish deploy. It is instant.
- **A policy or adapter change:** never edit a published version. Add a new one
  and point the default or the client at it. Old verdicts keep replaying with
  the versions they recorded.

## Rotating secrets

- **A partner API key:** add its SHA-256 to `REVOKED_KEY_HASHES` on Railway
  (comma-separated). It is refused at once after the redeploy. Issue the
  replacement through `SEED_CONSUMERS`.
- **`MINER_AUTH_KEY`:** set the new value on Railway, then run `install-key`
  (above) so Telegraph holds the same value.
- **`SKEIN_ATTESTATION_KEY`:** verdicts are signed when read, so a new key
  re-signs everything under the new signer. Publish the new address
  (`/v1/status` shows it) before clients pin it.
- **The purchaser key:** move the escrow balance out, generate a new key,
  fund it (guide 1), then set `PURCHASER_PRIVATE_KEY` on Railway.
- **The miner owner wallet** (`MINER_REGISTRATION_KEY`, in `skein-secrets.md`):
  it cannot be changed on a registration. To move ownership, deregister
  (`deregisterMiner(5137)` returns the bond) and register again from the new wallet.

## Alerts and errors

- **Alerts** arrive as GitHub issues labelled `alert`. The uptime workflow
  probes every 15 minutes and opens one when a check fails: API health,
  database, purchaser escrow, spend cap, unhandled errors, web, Desk, sniper,
  or the Telegraph miner. It mentions the owner, comments when the failures
  change, and closes itself on recovery. `ALERT_WEBHOOK_URL` (Slack or Discord)
  is optional and adds an immediate message from the API itself.
- **Errors:** every unhandled API error is kept for 30 days in `error_log`
  (message, stack, route, request id), and `/v1/status` shows
  `errorsLastHour`. The error body a caller sees carries the same request id,
  so a user's report leads straight to the row and the log line. `SENTRY_DSN` is
  optional and sends the same errors to Sentry.

## Scaling

The API runs as **two replicas** (Railway → `api` → Settings → Replicas).
Everything that must be shared lives in Postgres, so any number of replicas
behaves as one:
- **Rate limits:** `rate_limits`, one atomic statement per request, exact
  under concurrency (`apps/api/src/limits.ts`).
- **Telegraph-dispatched verdicts:** a lease per token and policy in
  `flights`, so the same ask on two replicas buys one verdict, and both
  answer it.
- **Idempotency:** `verdict_runs`. A retry on another replica returns the
  same verdict, charged once.
- **Event streams (SSE):** a replica that is not running the verdict follows
  the `events` table to the end.
- **Spend caps:** atomic holds in `spend_holds`.

Per replica, and harmless: catalogue refresh, the lost-run sweep, wallet
and cap checks (an alert can arrive once from each replica), and draining on
SIGTERM. `RATE_LIMIT_STORE=memory` puts rate limits back in process, for one
replica only. `apps/api/test/replicas.test.ts` runs two replicas on one
database.

## Backups

- **Postgres:** the `backup` service (`apps/backup`, a Railway cron job, daily
  at 03:17 UTC) runs `pg_dump` in custom format and uploads it to the private
  Railway bucket `skein-backups` under `postgres/`, keeping the newest 30.
  Railway's own volume backups need a Pro workspace, which this project is not
  on; if it moves to Pro, turn those on too (Postgres → Backups). Each run logs
  `backup uploaded` with the key, size and table count.

  To restore: in Railway, open the bucket → Credentials, then, with those values
  in `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL`:
  ```sh
  aws s3 ls s3://<bucket>/postgres/                       # pick a dump
  aws s3 cp s3://<bucket>/postgres/skein-<time>.dump .
  pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" skein-<time>.dump
  ```
  Restore into a new Postgres service first and point the API at it only once
  `/readyz` and a `pnpm repro` of a recent verdict pass. The data that matters is:
  - `verdict_runs` and `purchases`: every paid receipt;
  - `consumers`: partner keys, stored as hashes.

  Every stored verdict also replays from its row alone (`pnpm repro`), so a
  restore can be checked.
- **Desk store:** the `kv` table in the same Postgres, so it is covered by the
  database's backups. The old Netlify Blobs store (`site:desk`) is kept, read-only.
