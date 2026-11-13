import { describe, expect, it, vi } from "vitest";
import type { LiveEvent } from "../lib/graph";
import { watchEvents, type EventSourceLike } from "../lib/stream";

/** A stand-in EventSource the test drives by hand. */
class FakeSource implements EventSourceLike {
  readyState = 0; // CONNECTING
  closed = false;
  private listeners = new Map<string, ((e: Event) => void)[]>();
  addEventListener(type: string, fn: (e: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  /** A connection error: EventSource fires a plain Event named "error". */
  fail(readyState: 0 | 2) {
    this.readyState = readyState;
    for (const fn of this.listeners.get("error") ?? []) fn(new Event("error"));
  }
  send(type: string, data: unknown, id?: string) {
    const e = Object.assign(new Event(type), { data: JSON.stringify(data), lastEventId: id ?? "" });
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
}

function watch() {
  const src = new FakeSource();
  const events: LiveEvent[] = [];
  const onLost = vi.fn();
  watchEvents("http://x/events", { onEvent: (e) => events.push(e), onLost }, () => src);
  return { src, events, onLost };
}

describe("live stream watcher", () => {
  it("falls back at once when the connection is refused (readyState CLOSED: a 429, a 404, a refused socket)", () => {
    const { src, onLost } = watch();
    src.fail(2);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(src.closed).toBe(true);
    src.fail(2);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it("lets EventSource retry a dropped connection twice, and falls back on the third drop", () => {
    const { src, onLost } = watch();
    src.fail(0);
    src.fail(0);
    expect(onLost).not.toHaveBeenCalled();
    src.fail(0);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it("applies each event once, and stops at the end of the run without falling back", () => {
    const { src, events, onLost } = watch();
    src.send("plan", { ok: true, purchases: [] }, "1");
    src.send("plan", { ok: true, purchases: [] }, "1"); // resent after a reconnect
    src.fail(0);
    src.send("finding", { check: "sanctions", status: "PASS" }, "2");
    src.send("done", { id: "vrd_x" }, "3");
    expect(events.map((e) => e.type)).toEqual(["plan", "finding", "done"]);
    expect(src.closed).toBe(true);
    src.fail(2);
    expect(onLost).not.toHaveBeenCalled();
  });

  it("treats the server's own error event as the end of the run, not a lost stream", () => {
    const { src, events, onLost } = watch();
    src.send("error", { message: "boom" }, "1");
    expect(events).toEqual([{ type: "error", payload: { message: "boom" } }]);
    expect(onLost).not.toHaveBeenCalled();
  });
});
