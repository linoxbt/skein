import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// The Docker image (apps/web/Dockerfile) builds a standalone server traced
// from the monorepo root; hosts with a Next.js runtime (Netlify) build normally.
const standalone = process.env.BUILD_STANDALONE === "1";

// A deployed build must know its API: without it the site would quietly call localhost.
const api = process.env.NEXT_PUBLIC_SKEIN_API;
if (process.env.NETLIFY === "true" && !api) throw new Error("NEXT_PUBLIC_SKEIN_API must be set for a deployed build");
const apiOrigin = api ? new URL(api).origin : "http://localhost:8787";

/**
 * Security headers. Next.js inlines its bootstrap scripts, so script-src
 * keeps 'unsafe-inline'; what the policy does stop is loading or sending
 * anything to an origin other than this site and the Skein API.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  // The API, and the Telegraph node's public miner registry (the ledger reads Skein's registration from it).
  `connect-src 'self' ${apiOrigin} https://devnode.telegraphprotocol.com`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@skein/ui", "@skein/engine"],
  ...(standalone ? { output: "standalone", outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)) } : {}),
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
