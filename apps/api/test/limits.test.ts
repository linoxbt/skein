import { beforeAll, describe, expect, it } from "vitest";
import { acquireFlight, pruneShared, releaseFlight, SharedRateLimiter } from "../src/limits";
import { simulatedApi } from "../src/simulated";

let db: Awaited<ReturnType<typeof simulatedApi>>["db"];
beforeAll(async () => {
  ({ db } = await simulatedApi({ fast: true, env: {} }));
});

describe("shared rate limits", () => {
  it("count requests across replicas: two limiters on one database share one budget", async () => {
    const replicaA = new SharedRateLimiter(db, "test", 3);
    const replicaB = new SharedRateLimiter(db, "test", 3);
    const results = [await replicaA.take("ip:1"), await replicaB.take("ip:1"), await replicaA.take("ip:1"), await replicaB.take("ip:1")];
    expect(results.slice(0, 3)).toEqual([null, null, null]);
    expect(results[3]).toBeGreaterThanOrEqual(1); // refused, with a Retry-After in seconds
    expect(await replicaA.take("ip:2")).toBeNull(); // another key has its own bucket
    expect(await new SharedRateLimiter(db, "other", 3).take("ip:1")).toBeNull(); // and so does another limiter
  });

  it("stays exact under concurrency", async () => {
    const l = new SharedRateLimiter(db, "burst", 5);
    const out = await Promise.all(Array.from({ length: 12 }, () => l.take("k")));
    expect(out.filter((x) => x === null)).toHaveLength(5);
  });
});

describe("flight leases", () => {
  it("one run holds a key; others see the holder; it can be released, and an expired lease is taken over", async () => {
    expect(await acquireFlight(db, "8453:0xabc:dex-list@0.2.0", "vrd_a", 60_000)).toBeNull();
    expect(await acquireFlight(db, "8453:0xabc:dex-list@0.2.0", "vrd_b", 60_000)).toBe("vrd_a");
    await releaseFlight(db, "8453:0xabc:dex-list@0.2.0", "vrd_b"); // not the holder: no effect
    expect(await acquireFlight(db, "8453:0xabc:dex-list@0.2.0", "vrd_c", 60_000)).toBe("vrd_a");
    await releaseFlight(db, "8453:0xabc:dex-list@0.2.0", "vrd_a");
    expect(await acquireFlight(db, "8453:0xabc:dex-list@0.2.0", "vrd_c", 60_000)).toBeNull();

    expect(await acquireFlight(db, "k2", "vrd_old", -1_000)).toBeNull(); // already expired
    expect(await acquireFlight(db, "k2", "vrd_new", 60_000)).toBeNull(); // taken over
    expect(await acquireFlight(db, "k2", "vrd_late", 60_000)).toBe("vrd_new");
    await pruneShared(db);
  });
});
