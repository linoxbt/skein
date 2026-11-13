// node packages/sdk/scripts/check-published.mjs [package dir] [--no-build]
//
// Fails when the version in package.json is already on npm with different
// contents: a fix built under a version number that is already published never
// reaches anyone (0.3.0 on npm lacked the Nov 11 multi-chain 402 fix that the
// local 0.3.0 carried). Packs the local build with `pnpm pack` (publishConfig
// applied, as `pnpm publish` does), downloads the npm tarball of the same
// version, and compares every file. Exit 0 when the version is unpublished (bump
// is pending a release) or byte-identical; exit 1 with the differing files
// otherwise: bump the version. Run it in CI after the build, for packages/sdk
// and packages/mcp. Needs read access to the npm registry; publishes nothing.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const pkgDir = resolve(args.find((a) => !a.startsWith("--")) ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const run = (cmd, argv, cwd) => execFileSync(cmd, argv, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });

let published;
try {
  published = JSON.parse(run("npm", ["view", `${pkg.name}@${pkg.version}`, "version", "--json"], pkgDir) || "null");
} catch (e) {
  if (!/E404|is not in this registry|No match found/i.test(String(e.stderr ?? e.message))) throw e;
}
if (!published) {
  console.log(`${pkg.name}@${pkg.version} is not on npm yet: nothing to compare (it will be published as built)`);
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), "skein-published-"));
/** Every file of an unpacked tarball, by path, as a SHA-256. */
function files(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(dir, p), createHash("sha256").update(readFileSync(p)).digest("hex"));
    }
  };
  walk(dir);
  return out;
}
function unpack(tgz, into) {
  mkdirSync(into, { recursive: true });
  // Data only: listed and hashed, never run.
  run("tar", ["-xzf", tgz, "-C", into, "--no-same-owner", "--no-same-permissions"], work);
  return files(join(into, "package"));
}
try {
  if (!args.includes("--no-build")) run("pnpm", ["build"], pkgDir);
  const localDir = join(work, "local");
  const npmDir = join(work, "npm");
  mkdirSync(localDir);
  mkdirSync(npmDir);
  run("pnpm", ["pack", "--pack-destination", localDir], pkgDir);
  run("npm", ["pack", `${pkg.name}@${pkg.version}`, "--pack-destination", npmDir, "--silent"], work);
  const a = unpack(join(localDir, readdirSync(localDir).find((f) => f.endsWith(".tgz"))), join(work, "a"));
  const b = unpack(join(npmDir, readdirSync(npmDir).find((f) => f.endsWith(".tgz"))), join(work, "b"));
  const differ = [...new Set([...a.keys(), ...b.keys()])].sort().filter((f) => a.get(f) !== b.get(f));
  if (differ.length) {
    console.error(`FAIL: ${pkg.name}@${pkg.version} is already on npm and the local build differs in ${differ.length} file(s):`);
    for (const f of differ) console.error(`  ${f}: ${!a.has(f) ? "only on npm" : !b.has(f) ? "only in the local build" : "contents differ"}`);
    console.error("Bump the version: the published tarball cannot be replaced.");
    process.exitCode = 1;
  } else {
    console.log(`ok: ${pkg.name}@${pkg.version} on npm matches the local build (${a.size} files)`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
