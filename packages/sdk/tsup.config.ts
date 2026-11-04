import { defineConfig } from "tsup";

// Two entries: the client (no runtime dependencies) and the Telegraph rail,
// which bundles the workspace's private Telegraph client and needs viem as a
// peer. `paths` points the declaration bundler at that client's source, so its
// types are inlined too and the published .d.ts imports nothing private.
export default defineConfig({
  entry: { index: "src/index.ts", telegraph: "src/telegraph.ts" },
  format: ["esm"],
  dts: { compilerOptions: { baseUrl: ".", paths: { "@skein/telegraph": ["../telegraph/src/index.ts"] } } },
  clean: true,
  target: "es2022",
  sourcemap: true,
  noExternal: [/^@skein\//],
  external: ["viem", /^viem\//],
});
