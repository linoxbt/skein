/** One parsed server-sent event. */
export interface RawEvent {
  event: string;
  data: string;
  id?: string;
}

/**
 * Parses a text/event-stream body into events (WHATWG rules: fields per line,
 * a blank line dispatches, "data" lines join with \n, ":" lines are comments).
 * Works on any fetch Response, in Node or the browser.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<RawEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let event = "message";
  let data: string[] = [];
  let id: string | undefined;
  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.search(/\r\n|\r|\n/)) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + (buf.startsWith("\r\n", nl) ? 2 : 1));
        if (line === "") {
          if (data.length) yield { event, data: data.join("\n"), ...(id !== undefined ? { id } : {}) };
          event = "message";
          data = [];
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
        else if (field === "id") id = value;
      }
    }
    if (data.length) yield { event, data: data.join("\n"), ...(id !== undefined ? { id } : {}) };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
