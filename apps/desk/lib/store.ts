import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Application } from "./types";

/** Where applications live: Netlify Blobs in production, a folder in dev, memory in tests. */
export interface Store {
  get(id: string): Promise<Application | null>;
  put(a: Application): Promise<void>;
  list(): Promise<Application[]>;
}

const newestFirst = (xs: Application[]) => xs.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

export function memoryStore(): Store {
  const m = new Map<string, Application>();
  return {
    get: async (id) => structuredClone(m.get(id) ?? null),
    put: async (a) => void m.set(a.id, structuredClone(a)),
    list: async () => newestFirst([...m.values()].map((a) => structuredClone(a))),
  };
}

export function fileStore(dir: string): Store {
  const path = (id: string) => join(dir, `${id.replace(/[^\w-]/g, "")}.json`);
  return {
    async get(id) {
      try {
        return JSON.parse(await readFile(path(id), "utf8")) as Application;
      } catch {
        return null;
      }
    },
    async put(a) {
      await mkdir(dir, { recursive: true });
      const tmp = `${path(a.id)}.tmp`;
      await writeFile(tmp, JSON.stringify(a));
      await rename(tmp, path(a.id));
    },
    async list() {
      const names = await readdir(dir).catch(() => [] as string[]);
      const all = await Promise.all(names.filter((n) => n.endsWith(".json")).map((n) => readFile(join(dir, n), "utf8").then((t) => JSON.parse(t) as Application)));
      return newestFirst(all);
    },
  };
}

export async function blobStore(): Promise<Store> {
  const { getStore } = await import("@netlify/blobs");
  const s = getStore({ name: "desk-applications", consistency: "strong" });
  return {
    get: async (id) => ((await s.get(id, { type: "json" })) as Application | null) ?? null,
    put: async (a) => void (await s.setJSON(a.id, a)),
    async list() {
      const { blobs } = await s.list();
      const all = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" }) as Promise<Application | null>));
      return newestFirst(all.filter((a): a is Application => a !== null));
    },
  };
}

let current: Promise<Store> | null = null;
/** DESK_STORE=blobs|file|memory; by default Blobs when running on Netlify, else .desk-data/. */
export function defaultStore(): Promise<Store> {
  if (!current) {
    const kind = process.env.DESK_STORE ?? ("Netlify" in globalThis || process.env.NETLIFY_BLOBS_CONTEXT ? "blobs" : "file");
    current = kind === "blobs" ? blobStore() : Promise.resolve(kind === "memory" ? memoryStore() : fileStore(process.env.DESK_DATA_DIR ?? ".desk-data"));
  }
  return current;
}
