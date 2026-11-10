import { Alerter, type Queryable } from "@skein/alerts";

/**
 * The API's alerts (wallet low, spend cap near, verdicts lost, unhandled
 * errors), delivered to ALERT_WEBHOOK_URL: an ntfy topic, Slack or Discord
 * (packages/alerts). With the database, state is shared by every replica, so
 * an alert goes out once per episode and its recovery once.
 */
export class Alerts extends Alerter {
  constructor(opts: { url?: string; service?: string; repeatMs?: number; db?: Queryable; fetch?: typeof fetch; now?: () => number } = {}) {
    super({ ...opts, service: opts.service ?? "skein-api" });
  }
}
