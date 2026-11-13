import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Route handlers import "@/lib/…" (tsconfig paths); tests import them too.
// Excluded from tsconfig, so the Next build never type-checks a test tool.
export default defineConfig({
  resolve: { alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) }] },
});
