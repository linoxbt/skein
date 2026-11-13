/** A small renderer's view of an OpenAPI 3.1 document: its operations, with local $refs inlined. */
export type Json = Record<string, unknown>;
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** Inlines local $refs (#/components/…) one level at a time, guarding against cycles. */
export function deref(doc: Json, node: unknown, seen: ReadonlySet<string> = new Set()): unknown {
  if (Array.isArray(node)) return node.map((n) => deref(doc, n, seen));
  if (!node || typeof node !== "object") return node;
  const ref = (node as { $ref?: unknown }).$ref;
  if (typeof ref === "string" && ref.startsWith("#/")) {
    if (seen.has(ref)) return { $ref: ref };
    const target = ref
      .slice(2)
      .split("/")
      .reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Json)[k] : undefined), doc);
    return target === undefined ? node : deref(doc, target, new Set([...seen, ref]));
  }
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, deref(doc, v, seen)]));
}

export interface Operation {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  security?: unknown[];
  parameters?: { name: string; in: string; required?: boolean; description?: string; schema?: unknown }[];
  requestBody?: { content?: Record<string, { schema?: unknown }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: unknown }> }>;
}

/** Every operation in document order. */
export function operations(doc: Json): Operation[] {
  const paths = (doc.paths ?? {}) as Record<string, Json>;
  return Object.entries(paths).flatMap(([path, item]) =>
    METHODS.filter((m) => item[m]).map((m) => ({ method: m.toUpperCase(), path, ...(deref(doc, item[m]) as Omit<Operation, "method" | "path">) })),
  );
}

