import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPENAPI } from "../src/openapi";

describe("OpenAPI", () => {
  it("describes every route the app registers, with the right methods", () => {
    const src = ["../src/app.ts", "../src/keys.ts"].map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
    const routes = [...src.matchAll(/app\.(get|post|delete|put)\("([^"]+)"/g)].map(([, m, p]) => [m!, p!.replace(/:([a-z]+)/g, "{$1}")] as const);
    expect(routes.length).toBeGreaterThan(10);
    const paths = OPENAPI.paths as Record<string, Record<string, unknown>>;
    for (const [method, path] of routes) expect(paths[path]?.[method], `${method.toUpperCase()} ${path}`).toBeTruthy();
  });
});
