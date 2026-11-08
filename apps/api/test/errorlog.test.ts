import { schema } from "@skein/db";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { VerdictService } from "../src/service";
import { simulatedApi } from "../src/simulated";

describe("error log", () => {
  it("keeps an unhandled error with its request id, and /v1/status counts the last hour across replicas", async () => {
    const api = await simulatedApi({ fast: true, env: {} });
    const broken = new VerdictService({ ...api.service.deps });
    broken.findCached = async () => {
      throw new Error("cache exploded at 0xdeadbeef01");
    };
    const res = await createApp(broken).request("/v1/verdicts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${api.key}`, "idempotency-key": "boom" },
      body: JSON.stringify({ subject: { chainId: 8453, token: "0x00000000000000000000000000000000000e7701" } }),
    });
    expect(res.status).toBe(500);
    const { error } = (await res.json()) as { error: { code: string; message: string; requestId: string } };
    expect(error.message).toBe("internal error"); // nothing internal leaks to the caller
    await new Promise((r) => setTimeout(r, 50));
    const rows = await api.db.select().from(schema.errorLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ service: "skein-api", route: "POST /v1/verdicts", requestId: error.requestId });
    expect(rows[0]!.message).toContain("cache exploded");
    const status = (await (await api.app.request("/v1/status")).json()) as { errorsLastHour: number };
    expect(status.errorsLastHour).toBe(1);
  });
});
