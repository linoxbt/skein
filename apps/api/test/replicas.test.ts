import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { VerdictService } from "../src/service";
import { simulatedApi } from "../src/simulated";

let api: Awaited<ReturnType<typeof simulatedApi>>;
let replicaB: ReturnType<typeof createApp>;

beforeAll(async () => {
  api = await simulatedApi({ fast: true, env: {}, config: { minerAuthKey: "mk" } });
  // A second replica: its own service (no live buffers), the same database.
  replicaB = createApp(new VerdictService({ ...api.service.deps }));
});

const token = "0x00000000000000000000000000000000000abc1a";

describe("two replicas on one database", () => {
  it("a verdict started on one replica streams to the end through the other", async () => {
    const started = (await (
      await api.app.request("/v1/verdicts", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${api.key}`, "idempotency-key": "replica-sse" },
        body: JSON.stringify({ subject: { chainId: 8453, token }, mode: "async" }),
      })
    ).json()) as { id: string };
    const res = await replicaB.request(`/v1/verdicts/${started.id}/events`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const events = [...text.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);
    expect(events[0]).toBe("plan");
    expect(events).toContain("decision");
    expect(events.at(-1)).toBe("done");
  });

  it("an idempotent retry that lands on the other replica returns the same verdict, charged once", async () => {
    const send = (app: ReturnType<typeof createApp>) =>
      app.request("/v1/verdicts", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${api.key}`, "idempotency-key": "replica-idem" },
        body: JSON.stringify({ subject: { chainId: 8453, token: "0x00000000000000000000000000000000000abc2a" } }),
      });
    const charges = api.node.charges.length;
    const a = (await (await send(api.app)).json()) as { id: string };
    const bought = api.node.charges.length - charges;
    const b = (await (await send(replicaB)).json()) as { id: string };
    expect(b.id).toBe(a.id);
    expect(api.node.charges.length - charges).toBe(bought);
  });

  it("the same Telegraph ask on both replicas at once buys one verdict, and both answer it", async () => {
    const ask = (app: ReturnType<typeof createApp>) =>
      app.request("/miner/verdict", {
        method: "POST",
        headers: { "content-type": "application/json", "x-skein-miner-key": "mk" },
        body: JSON.stringify({ subject: "base:0x00000000000000000000000000000000000abc3a" }),
      });
    const before = api.node.charges.length;
    const [a, b] = await Promise.all([ask(api.app), ask(replicaB)]);
    const [ja, jb] = (await Promise.all([a.json(), b.json()])) as [{ id?: string; verdict: string }, { id?: string; verdict: string }];
    expect(ja.id).toBeTruthy();
    expect(jb.id).toBe(ja.id);
    // One verdict's worth of upstream purchases, not two.
    const one = (await api.app.request(`/v1/verdicts/${ja.id}/bom`).then((r) => r.json())) as { lines: { billed: boolean }[] };
    expect(api.node.charges.length - before).toBe(one.lines.filter((l) => l.billed).length);
  });
});
