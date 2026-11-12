// node scripts/netlify-bundle.mjs <app dir> <out dir>
//
// Builds the self-contained upload Netlify's builder installs with npm, outside
// the pnpm workspace: the app's sources, plus every @skein/* package it uses
// (transitively) copied into vendor/ and referenced as file: dependencies.
// The same script makes every deploy, so a deployed site is always a commit.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const [appArg, outArg] = process.argv.slice(2);
if (!appArg || !outArg) {
  console.error("usage: node scripts/netlify-bundle.mjs <app dir> <out dir>");
  process.exit(64);
}
const root = resolve(import.meta.dirname, "..");
const app = resolve(appArg);
const out = resolve(outArg);
const SKIP = new Set(["node_modules", ".next", ".turbo", "test", ".desk-data", "next-env.d.ts", "tsconfig.tsbuildinfo", "Dockerfile", "dist", ".netlify"]);
// Local env files hold secrets (keys live in Netlify's environment, never in an upload).
const isEnvFile = (name) => name.startsWith(".env") && name !== ".env.example";
const copyFiltered = (from, to) => cpSync(from, to, { recursive: true, filter: (src) => !SKIP.has(basename(src)) && !isEnvFile(basename(src)) });

// Every workspace library, found rather than listed, so a new package can't be missed.
const workspace = new Map();
for (const dir of readdirSync(join(root, "packages"))) {
  const file = join(root, "packages", dir, "package.json");
  if (!existsSync(file)) continue;
  workspace.set(JSON.parse(readFileSync(file, "utf8")).name, join(root, "packages", dir));
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
copyFiltered(app, out);

// The repository build (netlify.toml) runs pnpm from the repo root; an upload has
// no workspace above it and installs its vendored copy with npm instead.
const toml = join(out, "netlify.toml");
if (existsSync(toml)) {
  const text = readFileSync(toml, "utf8");
  const swapped = text.replace(/^\s*command\s*=.*$/m, '  command = "npm run build" # rewritten by scripts/netlify-bundle.mjs for an upload');
  if (swapped === text) throw new Error("netlify.toml has no build command to rewrite");
  writeFileSync(toml, swapped);
}

const vendored = new Set();
const isWorkspace = (spec) => typeof spec === "string" && spec.startsWith("workspace:");
function rewrite(pkg, vendorRel) {
  for (const field of ["dependencies"]) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (!isWorkspace(spec)) continue;
      vendor(name);
      pkg[field][name] = `file:${vendorRel}/${name.replace("@skein/", "")}`;
    }
  }
  // Workspace devDependencies are test tooling (e.g. @skein/api for in-process tests): not built on Netlify.
  for (const [name, spec] of Object.entries(pkg.devDependencies ?? {})) if (isWorkspace(spec)) delete pkg.devDependencies[name];
  for (const s of ["test", "typecheck"]) delete pkg.scripts?.[s];
  return pkg;
}
function vendor(name) {
  if (vendored.has(name)) return;
  vendored.add(name);
  const src = workspace.get(name);
  if (!src) throw new Error(`unknown workspace package ${name}`);
  const dest = join(out, "vendor", name.replace("@skein/", ""));
  // Sources only: build configs and tests belong to the workspace, not to the app's build.
  copyFiltered(join(src, "src"), join(dest, "src"));
  const pkg = JSON.parse(readFileSync(join(src, "package.json"), "utf8"));
  delete pkg.devDependencies;
  delete pkg.scripts;
  delete pkg.publishConfig;
  writeFileSync(join(dest, "package.json"), `${JSON.stringify(rewrite(pkg, ".."), null, 2)}\n`);
}

const appPkg = rewrite(JSON.parse(readFileSync(join(app, "package.json"), "utf8")), "./vendor");
// The workspace's security pins (root package.json pnpm.overrides, e.g. postcss)
// must hold in the npm install too: npm's overrides take a package name, so a
// range-scoped pnpm key ("postcss@<8.5.23") pins every copy to the fixed version.
const rootOverrides = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).pnpm?.overrides ?? {};
const overrides = Object.fromEntries(Object.entries(rootOverrides).map(([key, version]) => [key.replace(/(.)@.*$/, "$1"), version]));
if (Object.keys(overrides).length > 0) appPkg.overrides = { ...(appPkg.overrides ?? {}), ...overrides };
writeFileSync(join(out, "package.json"), `${JSON.stringify(appPkg, null, 2)}\n`);
if (existsSync(join(out, "vendor"))) console.log(`vendored: ${[...vendored].join(", ")}`);
console.log(`bundle ready: ${out}`);
