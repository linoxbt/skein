import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// The Docker image (apps/web/Dockerfile) builds a standalone server traced
// from the monorepo root; hosts with a Next.js runtime (Netlify) build normally.
const standalone = process.env.BUILD_STANDALONE === "1";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(standalone ? { output: "standalone", outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)) } : {}),
};

export default config;
