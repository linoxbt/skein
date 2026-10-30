import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // @skein/sdk ships TypeScript source.
  transpilePackages: ["@skein/sdk"],
};

export default config;
