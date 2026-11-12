// prepublishOnly guard. The package's `exports` point at src/ for the workspace;
// publishConfig swaps in dist/ (with main, types and typesVersions), and only
// `pnpm publish` applies publishConfig. `npm publish` would ship a package whose
// entry points are TypeScript sources missing from the tarball, so refuse it.
const agent = process.env.npm_config_user_agent ?? "";
if (!agent.startsWith("pnpm/")) {
  console.error(`refusing to publish with ${agent.split(" ")[0] || "an unknown client"}: use pnpm publish, which applies publishConfig (dist entry points)`);
  process.exit(1);
}
