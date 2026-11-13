import type { LiveEvent } from "./graph";

/** The part of EventSource the watcher uses (so a test can stand in for it). */
export interface EventSourceLike {
  readonly readyState: number;
  addEventListener(type: string, listener: (e: Event) => void): void;
  close(): void;
}

export const LIVE_EVENTS = ["plan", "purchase", "finding", "decision", "done", "refused", "error"] as const;
const TERMINAL = new Set<LiveEvent["type"]>(["done", "refused", "error"]);
/** EventSource.CLOSED, spelled out so this module also loads where EventSource does not exist. */
const CLOSED = 2;

export interface WatchHandlers {
  onEvent(e: LiveEvent): void;
  /** The stream is gone for good and the run has not ended: read the verdict instead (poll). Called at most once. */
  onLost(why: string): void;
}

/**
 * Follows a run's server-sent events. A connection error EventSource will
 * retry by itself (readyState CONNECTING) is given three tries. One it
 * will not retry (readyState CLOSED: a 404, a 429, a refused connection, a
 * response that is not an event stream) is lost at once: without this the
 * console waited on "Buying…" forever. Event ids are the run's sequence
 * numbers, so a reconnect (which resends Last-Event-ID) never applies an
 * event twice. Returns a function that stops watching.
 */
export function watchEvents(url: string, h: WatchHandlers, open: (url: string) => EventSourceLike = (u) => new EventSource(u)): () => void {
  const es = open(url);
  const seen = new Set<string>();
  let drops = 0;
  let over = false;
  const stop = () => {
    over = true;
    es.close();
  };
  const lost = (why: string) => {
    if (over) return;
    stop();
    h.onLost(why);
  };
  for (const type of LIVE_EVENTS) {
    es.addEventListener(type, (m) => {
      if (over) return;
      const msg = m as MessageEvent;
      if (typeof msg.data !== "string") {
        // A connection error, not the server's own "error" event.
        if (es.readyState === CLOSED) return lost("the live stream was refused");
        if (++drops >= 3) lost("the live stream dropped three times");
        return;
      }
      drops = 0;
      if (msg.lastEventId) {
        if (seen.has(msg.lastEventId)) return;
        seen.add(msg.lastEventId);
      }
      let payload: unknown;
      try {
        payload = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (TERMINAL.has(type)) stop();
      h.onEvent({ type, payload } as LiveEvent);
    });
  }
  return stop;
}
