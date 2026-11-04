import { defineConfig } from "tsup";

// The published server depends on @skeinlabs/sdk (Telegraph rail included)
// from npm, so `npx -y @skeinlabs/mcp` needs nothing else.
export default defineConfig([
  {
    entry: { "skein-mcp": "bin/skein-mcp.ts" },
    format: ["esm"],
    target: "node20",
    clean: true,
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    entry: { server: "src/server.ts" },
    format: ["esm"],
    target: "node20",
    dts: true,
  },
]);
