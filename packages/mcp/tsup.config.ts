import { defineConfig } from "tsup";

// The published server bundles the workspace packages it uses (@skein/sdk,
// @skein/telegraph, @skein/engine), so `npx @skein/mcp` needs nothing else.
export default defineConfig([
  {
    entry: { "skein-mcp": "bin/skein-mcp.ts" },
    format: ["esm"],
    target: "node20",
    clean: true,
    noExternal: [/^@skein\//],
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    entry: { server: "src/server.ts" },
    format: ["esm"],
    target: "node20",
    dts: true,
    noExternal: [/^@skein\//],
  },
]);
