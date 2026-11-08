/**
 * Pushes operational alerts (wallet low, spend cap near, verdicts lost) to a
 * chat webhook, so someone hears about them without watching /v1/status.
 * ALERT_WEBHOOK_URL takes a Slack incoming webhook or a Discord webhook: the
 * body carries both `text` (Slack) and `content` (Discord). Each alert key is
 * sent at most once per `repeatMs`, and again when the condition clears and
 * returns. Without a URL, alerts go to the log only.
 */
export class Alerts {
  private last = new Map<string, number>();

  constructor(
    private readonly opts: { url?: string; service?: string; repeatMs?: number; fetch?: typeof fetch; now?: () => number } = {},
  ) {}

  /** Raises `key` with `message`; true when it was sent (or logged) now. */
  async raise(key: string, message: string): Promise<boolean> {
    const now = (this.opts.now ?? Date.now)();
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev < (this.opts.repeatMs ?? 6 * 3_600_000)) return false;
    this.last.set(key, now);
    const text = `[${this.opts.service ?? "skein-api"}] ${message}`;
    console.warn(JSON.stringify({ level: "warn", msg: "alert", key, alert: message }));
    if (!this.opts.url) return true;
    try {
      const res = await (this.opts.fetch ?? fetch)(this.opts.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, content: text }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) console.error(JSON.stringify({ level: "error", msg: "alert not delivered", key, status: res.status }));
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "alert not delivered", key, error: (e as Error).message }));
    }
    return true;
  }

  /** The condition is over: the next raise of `key` is sent at once. */
  clear(key: string): void {
    this.last.delete(key);
  }
}
