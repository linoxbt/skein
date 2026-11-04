import { defineConfig } from "tsup";

// Two entries: the client (no runtime dependencies) and the Telegraph rail,
// which bundles the workspace's private Telegraph client (imported by relative
// path so its declarations are inlined too) and needs viem as a peer.
export default defineConfig({
  entry: { index: "src/index.ts", telegraph: "src/telegraph.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  sourcemap: true,
  noExternal: [/^@skein\//],
  external: ["viem", /^viem\//],
});
