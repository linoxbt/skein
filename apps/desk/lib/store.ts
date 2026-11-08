import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Application } from "./types";

/** A stored value and the version it was read at; writes name the version they replace. */
export interface Versioned<T> {
  value: T;
  etag: string;
}

/**
 * Where the Desk keeps its state: Netlify Blobs in production, a folder in
 * dev, memory in tests. Every write is compare-and-swap (create only if new,
 * update only if unchanged), so two agents can never both act on the same
 * application, and a decision, once written, is never overwritten.
 */
export interface KV {
  get<T>(key: string): Promise<Versioned<T> | null>;
  /** Writes only if the key does not exist. */
  create<T>(key: string, value: T): Promise<boolean>;
  /** Writes only if the key still has `etag`. */
  update<T>(key: string, value: T, etag: string): Promise<boolean>;
}

function memoryKV(): KV {
  const m = new Map<string, { value: string; etag: string }>();
  let v = 0;
  return {
    async get<T>(key: string) {
      const hit = m.get(key);
      return hit ? { value: JSON.parse(hit.value) as T, etag: hit.etag } : null;
    },
    async create<T>(key: string, value: T) {
      if (m.has(key)) return false;
      m.set(key, { value: JSON.stringify(value), etag: String(++v) });
      return true;
    },
    async update<T>(key: string, value: T, etag: string) {
      if (m.get(key)?.etag !== etag) return false;
      m.set(key, { value: JSON.stringify(value), etag: String(++v) });
      return true;
    },
  };
}

/** One process (`next dev`); a mutex per key keeps compare-and-swap honest across concurrent requests. */
function fileKV(dir: string): KV {
  const path = (key: string) => join(dir, `${key.replace(/[^\w.-]/g, "_")}.json`);
  const locks = new Map<string, Promise<unknown>>();
  const locked = async <R>(key: string, f: () => Promise<R>): Promise<R> => {
    const prev = locks.get(key) ?? Promise.resolve();
    const next = prev.then(f, f);
    locks.set(key, next.catch(() => {}));
    return next;
  };
  const read = async (key: string) => {
    try {
      return JSON.parse(await readFile(path(key), "utf8")) as { value: unknown; etag: string };
    } catch {
      return null;
    }
  };
  const write = async (key: string, value: unknown, etag: string) => {
    await mkdir(dir, { recursive: true });
    const tmp = `${path(key)}.${etag}.tmp`;
    await writeFile(tmp, JSON.stringify({ value, etag }));
    await rename(tmp, path(key));
  };
  const nextTag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return {
    async get<T>(key: string) {
      const r = await read(key);
      return r ? { value: r.value as T, etag: r.etag } : null;
    },
    create: (key, value) =>
      locked(key, async () => {
        if (await read(key)) return false;
        await write(key, value, nextTag());
        return true;
      }),
    update: (key, value, etag) =>
      locked(key, async () => {
        if ((await read(key))?.etag !== etag) return false;
        await write(key, value, nextTag());
        return true;
      }),
  };
}

/** Fails a Blobs call that does not answer, rather than letting it hold a function for 30 s. */
async function within<T>(ms: number, what: string, p: Promise<T>): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => (t = setTimeout(() => reject(new Error(`blobs ${what}: no answer in ${ms} ms`)), ms)))]);
  } finally {
    clearTimeout(t);
  }
}

async function blobKV(): Promise<KV> {
  const { getStore } = await import("@netlify/blobs");
  const s = getStore({ name: "desk", consistency: "strong" });
  return {
    async get<T>(key: string) {
      // A get of a key that does not exist never answers on Netlify's runtime
      // (@netlify/blobs 11.1.4, observed 2026-11-02), while list does: check first.
      const { blobs } = await within(8_000, `list ${key}`, s.list({ prefix: key }));
      if (!blobs.some((b) => b.key === key)) return null;
      const r = await within(8_000, `get ${key}`, s.getWithMetadata(key, { type: "json" }));
      return r && r.etag ? { value: r.data as T, etag: r.etag } : null;
    },
    async create<T>(key: string, value: T) {
      return (await within(8_000, `create ${key}`, s.setJSON(key, value, { onlyIfNew: true }))).modified;
    },
    async update<T>(key: string, value: T, etag: string) {
      return (await within(8_000, `update ${key}`, s.setJSON(key, value, { onlyIfMatch: etag }))).modified;
    },
  };
}

/**
 * The Desk's store on Skein's own API (GET/PUT /v1/kv), in Postgres behind
 * valid TLS, namespaced to the Desk's partner key. Replaced Netlify Blobs as
 * the default on 2026-11-08: Blobs stopped answering about half the calls
 * from the Desk's functions (DECISIONS L29). Conditional writes keep the
 * same semantics: create only if absent, replace only at the etag read.
 */
export function apiKV(base: string, key: string, fetchImpl: typeof fetch = fetch): KV {
  const url = (k: string) => `${base.replace(/\/$/, "")}/v1/kv?key=${encodeURIComponent(k)}`;
  const call = async (what: string, k: string, init: RequestInit) => {
    try {
      return await fetchImpl(url(k), { ...init, headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(5_000) });
    } catch (e) {
      throw new Error(`store ${what} ${k}: ${(e as Error).message}`);
    }
  };
  const fail = async (what: string, k: string, r: Response): Promise<never> => {
    throw new Error(`store ${what} ${k}: HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
  };
  return {
    async get<T>(k: string) {
      const r = await call("get", k, { method: "GET" });
      if (r.status === 404) return null;
      if (!r.ok) return fail("get", k, r);
      const body = (await r.json()) as { value: T; etag: string };
      return { value: body.value, etag: body.etag };
    },
    async create<T>(k: string, value: T) {
      const r = await call("create", k, { method: "PUT", headers: { "if-none-match": "*" }, body: JSON.stringify({ value }) });
      if (r.status === 412) return false;
      if (!r.ok) return fail("create", k, r);
      return true;
    },
    async update<T>(k: string, value: T, etag: string) {
      const r = await call("update", k, { method: "PUT", headers: { "if-match": etag }, body: JSON.stringify({ value }) });
      if (r.status === 412) return false;
      if (!r.ok) return fail("update", k, r);
      return true;
    },
  };
}

/** Read, change, write back; retried when another writer got there first. */
export async function mutate<T>(kv: KV, key: string, f: (current: T | null) => T | null, tries = 8): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    const cur = await kv.get<T>(key);
    const next = f(cur?.value ?? null);
    if (next === null) return cur?.value ?? null;
    const ok = cur ? await kv.update(key, next, cur.etag) : await kv.create(key, next);
    if (ok) return next;
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 60));
  }
  throw new Error(`write contention on ${key}`);
}

/** Atomically takes one unit of a counter; false once it reaches `limit`. */
export async function take(kv: KV, key: string, limit: number): Promise<boolean> {
  let granted = false;
  await mutate<number>(kv, key, (n) => {
    granted = (n ?? 0) < limit;
    return granted ? (n ?? 0) + 1 : null;
  });
  return granted;
}

/** The board's view of one application: no contact details, nothing beyond what the queue shows. */
export type Summary = Pick<Application, "id" | "receivedAt" | "source" | "project" | "subject" | "status"> & {
  decision?: Pick<NonNullable<Application["decision"]>, "at" | "action" | "verdict" | "verdictId" | "summary" | "rail" | "paidUsdc" | "listPriceUsdc" | "upstreamUsdc" | "receipts" | "seconds" | "verdictHash" | "refusal">;
};

export function summarise(a: Application): Summary {
  const d = a.decision;
  return {
    id: a.id, receivedAt: a.receivedAt, source: a.source, project: a.project, subject: a.subject, status: a.status,
    ...(d
      ? {
          decision: {
            at: d.at, action: d.action, verdict: d.verdict, verdictId: d.verdictId, summary: d.summary, rail: d.rail, paidUsdc: d.paidUsdc,
            listPriceUsdc: d.listPriceUsdc, upstreamUsdc: d.upstreamUsdc, receipts: d.receipts, seconds: d.seconds, verdictHash: d.verdictHash,
            ...(d.refusal ? { refusal: d.refusal } : {}),
          },
        }
      : {}),
  };
}

const INDEX = "index";
const INDEX_MAX = 500;

/** The Desk's records on top of a KV: applications, one index the board reads in a single get, and counters. */
export class Store {
  constructor(readonly kv: KV) {}

  async get(id: string): Promise<Versioned<Application> | null> {
    return this.kv.get<Application>(`app/${id}`);
  }

  async create(a: Application): Promise<boolean> {
    if (!(await this.kv.create(`app/${a.id}`, a))) return false;
    await this.reindex(a);
    return true;
  }

  /** Compare-and-swap on one application; the index follows. */
  async update(a: Application, etag: string): Promise<boolean> {
    if (!(await this.kv.update(`app/${a.id}`, a, etag))) return false;
    await this.reindex(a);
    return true;
  }

  private async reindex(a: Application): Promise<void> {
    await mutate<Summary[]>(this.kv, INDEX, (cur) => {
      const rest = (cur ?? []).filter((s) => s.id !== a.id);
      return [summarise(a), ...rest].sort((x, y) => y.receivedAt.localeCompare(x.receivedAt)).slice(0, INDEX_MAX);
    });
  }

  /** Newest first, the latest INDEX_MAX. One read. */
  async list(): Promise<Summary[]> {
    return (await this.kv.get<Summary[]>(INDEX))?.value ?? [];
  }

  take(counter: string, limit: number): Promise<boolean> {
    return take(this.kv, `count/${counter}`, limit);
  }
}

export function memoryStore(): Store {
  return new Store(memoryKV());
}

export function fileStore(dir: string): Store {
  return new Store(fileKV(dir));
}

let current: Promise<Store> | null = null;
/** DESK_STORE=api|blobs|file|memory; by default Skein's /v1/kv on Netlify (Blobs without a key), else .desk-data/. */
export function defaultStore(): Promise<Store> {
  if (!current) {
    const onNetlify = "Netlify" in globalThis || !!process.env.NETLIFY_BLOBS_CONTEXT || process.env.NETLIFY === "true";
    const apiKey = process.env.DESK_SKEIN_KEY;
    const apiUrl = process.env.SKEIN_API_URL ?? "https://api.skeinlabs.site";
    const kind = process.env.DESK_STORE ?? (onNetlify ? (apiKey ? "api" : "blobs") : "file");
    current =
      kind === "api"
        ? Promise.resolve(new Store(apiKV(apiUrl, apiKey!)))
        : kind === "blobs"
          ? blobKV().then((kv) => new Store(kv))
          : Promise.resolve(kind === "memory" ? memoryStore() : fileStore(process.env.DESK_DATA_DIR ?? ".desk-data"));
  }
  return current;
}
