import { defineConfig } from "tsup";

// Three entries: the client (no runtime dependencies); the Telegraph rail,
// which bundles the workspace's private Telegraph client and needs viem as a
// peer; and attest, the signature check (viem too). `paths` points the
// declaration bundler at private sources, so their types are inlined and the
// published .d.ts imports nothing private.
export default defineConfig({
  entry: { index: "src/index.ts", telegraph: "src/telegraph.ts", attest: "src/attest.ts" },
  format: ["esm"],
  dts: { compilerOptions: { baseUrl: ".", paths: { "@skein/telegraph": ["../telegraph/src/index.ts"], "@skein/engine/attest": ["../engine/src/attest.ts"] } } },
  clean: true,
  target: "es2022",
  sourcemap: true,
  noExternal: [/^@skein\//],
  external: ["viem", /^viem\//],
});
