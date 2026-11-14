import { createHash } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { beforeAll, describe, expect, it } from "vitest";
import { DEV_KEY, simulatedApi } from "../src/simulated";

type Api = Awaited<ReturnType<typeof simulatedApi>>;
const ADMIN_KEY = "sk_admin_test_only";
const ADMIN_HASH = createHash("sha256").update(ADMIN_KEY).digest("hex");
const json = { "content-type": "application/json" };
const alice = privateKeyToAccount(`0x${"a1".repeat(32)}`);
const mallory = privateKeyToAccount(`0x${"b2".repeat(32)}`);
const TOKEN = "0x4200000000000000000000000000000000000006";

let api: Api;
beforeAll(async () => {
  api = await simulatedApi({ fast: true, env: {}, config: { adminKeyHashes: [ADMIN_HASH] } });
});

const req = (a: Api, path: string, init: { method?: string; key?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  a.app.request(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: { ...json, ...(init.key ? { authorization: `Bearer ${init.key}` } : {}), ...init.headers },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

/** Signs in with a wallet: the challenge, the signature, the key. */
async function signIn(a: Api, signer = alice, signAs = signer, name?: string) {
  const ch = (await (await req(a, "/v1/keys/challenge", { body: { address: signer.address.toLowerCase() } })).json()) as { nonce: string; message: string; address: string };
  const signature = await signAs.signMessage({ message: ch.message });
  const res = await req(a, "/v1/keys", { body: { nonce: ch.nonce, signature, ...(name ? { name } : {}) } });
  return { ch, signature, res, body: (await res.json()) as Record<string, unknown> };
}

const verdict = (a: Api, key: string, token = TOKEN) => req(a, "/v1/verdicts", { key, body: { subject: { chainId: 8453, token } }, headers: { "idempotency-key": crypto.randomUUID() } });
/** A token no test has bought a verdict for: a cached verdict is free, so caps only bite on a new one. */
const FRESH = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

describe("self-serve keys: a wallet signs in and gets one", () => {
  it("issues a working key for a signed challenge; signing again replaces it", async () => {
    const first = await signIn(api, alice, alice, "Alice bot");
    expect(first.ch.message).toContain(`Address: ${alice.address}`);
    expect(first.res.status).toBe(201);
    expect(first.body).toMatchObject({ wallet: alice.address, plan: "self", name: "Alice bot", dailyCapUsdc: 0.5, replaced: false });
    const key1 = first.body.key as string;
    expect(key1).toMatch(/^sk_part_/);
    expect((await verdict(api, key1)).status).toBe(200);

    const second = await signIn(api);
    expect(second.body).toMatchObject({ replaced: true });
    expect((await verdict(api, key1)).status).toBe(401);
    expect((await verdict(api, second.body.key as string)).status).toBe(200);
  });

  it("uses a challenge once, and only for the wallet it names", async () => {
    const ok = await signIn(api);
    const replay = await req(api, "/v1/keys", { body: { nonce: ok.ch.nonce, signature: ok.signature } });
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: { code: string } }).error.code).toBe("CHALLENGE_EXPIRED");

    const forged = await signIn(api, alice, mallory);
    expect(forged.res.status).toBe(401);
    expect((forged.body as { error: { code: string } }).error.code).toBe("BAD_SIGNATURE");
  });

  it("refuses a bad address or a malformed claim", async () => {
    const api = await simulatedApi({ fast: true, env: {} });
    expect((await req(api, "/v1/keys/challenge", { body: { address: "0x123" } })).status).toBe(400);
    expect((await req(api, "/v1/keys", { body: { nonce: "nope", signature: "0x00" } })).status).toBe(400);
  });

  it("can be turned off", async () => {
    const off = await simulatedApi({ fast: true, env: {}, config: { selfServe: { enabled: false, capUusdc: 500_000, totalDailyUusdc: 3_000_000 } } });
    const r = await req(off, "/v1/keys/challenge", { body: { address: alice.address } });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("SELF_SERVE_OFF");
  });

  it("stops every self-serve key once their shared daily budget is spent, and only them", async () => {
    const tight = await simulatedApi({ fast: true, env: {}, config: { selfServe: { enabled: true, capUusdc: 500_000, totalDailyUusdc: 0 } } });
    const { body } = await signIn(tight);
    const r = await verdict(tight, body.key as string);
    expect(r.status).toBe(429);
    expect(((await r.json()) as { error: { message: string } }).error.message).toMatch(/share a daily budget/);
    expect((await verdict(tight, DEV_KEY)).status).toBe(200);
  });
});

describe("admin: manage every key", () => {
  it("is closed without the admin key, and when none is configured", async () => {
    expect((await req(api, "/v1/admin/keys")).status).toBe(401);
    expect((await req(api, "/v1/admin/keys", { key: DEV_KEY })).status).toBe(401);
    const none = await simulatedApi({ fast: true, env: {} });
    expect((await req(none, "/v1/admin/keys", { key: ADMIN_KEY })).status).toBe(403);
  });

  it("lists keys, creates one, changes its cap and revokes it for good", async () => {
    const created = await req(api, "/v1/admin/keys", { key: ADMIN_KEY, body: { name: "Launchpad X", kind: "team", dailyCapUsdc: 1.5 } });
    expect(created.status).toBe(201);
    const c = (await created.json()) as { key: string; id: string; dailyCapUsdc: number; plan: string };
    expect(c).toMatchObject({ dailyCapUsdc: 1.5, plan: "partner" });
    expect((await verdict(api, c.key)).status).toBe(200);

    const list = (await (await req(api, "/v1/admin/keys", { key: ADMIN_KEY })).json()) as {
      selfServe: { enabled: boolean; dailyCapUsdc: number; totalDailyUsdc: number };
      keys: { id: string; name: string; plan: string; spentTodayUsdc: number; revokedAt: string | null }[];
    };
    expect(list.selfServe).toMatchObject({ enabled: true, dailyCapUsdc: 0.5, totalDailyUsdc: 3 });
    const mine = list.keys.find((k) => k.id === c.id)!;
    expect(mine).toMatchObject({ name: "Launchpad X", plan: "partner", revokedAt: null });
    // Today's upstream spend per key (0 here: the verdict above was served from cache).
    expect(typeof mine.spentTodayUsdc).toBe("number");
    // No key material is ever listed.
    expect(JSON.stringify(list)).not.toMatch(/sk_part_|api_?key_?hash/i);

    const capped = await req(api, `/v1/admin/keys/${c.id}`, { key: ADMIN_KEY, body: { dailyCapUsdc: 0 } });
    expect(await capped.json()).toMatchObject({ dailyCapUsdc: 0 });
    expect((await verdict(api, c.key, FRESH)).status).toBe(429);

    const revoked = await req(api, `/v1/admin/keys/${c.id}/revoke`, { key: ADMIN_KEY, body: {} });
    expect(await revoked.json()).toMatchObject({ id: c.id, final: true });
    expect((await verdict(api, c.key)).status).toBe(401);
    expect((await req(api, `/v1/admin/keys/${c.id}/revoke`, { key: ADMIN_KEY, body: {} })).status).toBe(200);
    expect((await req(api, `/v1/admin/keys/${c.id}`, { key: ADMIN_KEY, body: { dailyCapUsdc: 1 } })).status).toBe(409);
  });

  it("revokes a self-serve key too, and checks what it is given", async () => {
    // A fresh API: the others have used this caller's five key issues for the minute.
    const api = await simulatedApi({ fast: true, env: {}, config: { adminKeyHashes: [ADMIN_HASH] } });
    const { body } = await signIn(api, mallory, mallory);
    const r = await req(api, `/v1/admin/keys/${body.id}/revoke`, { key: ADMIN_KEY, body: {} });
    expect(r.status).toBe(200);
    expect((await verdict(api, body.key as string)).status).toBe(401);
    expect((await req(api, "/v1/admin/keys", { key: ADMIN_KEY, body: { name: "", dailyCapUsdc: 1 } })).status).toBe(400);
    expect((await req(api, "/v1/admin/keys", { key: ADMIN_KEY, body: { name: "ok", dailyCapUsdc: 1000 } })).status).toBe(400);
    expect((await req(api, "/v1/admin/keys/not-a-uuid/revoke", { key: ADMIN_KEY, body: {} })).status).toBe(400);
  });
});
