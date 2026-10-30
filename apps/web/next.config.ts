import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
  // Trace from the monorepo root so the standalone server carries its dependencies.
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
};

export default config;
