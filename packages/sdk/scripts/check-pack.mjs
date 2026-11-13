// node scripts/check-pack.mjs [--no-build] [--from-npm <version>]
//
// Installs the package the way an outside developer gets it, with plain npm,
// and uses it:
//   1. builds (unless --no-build) and packs with `pnpm pack`, which applies
//      publishConfig exactly as `pnpm publish` does; or, with --from-npm,
//      downloads that published version instead;
//   2. `npm install`s the tarball and viem into an empty project;
//   3. imports every entry point (".", "./telegraph", "./attest", "./webhooks")
//      and checks main/types/typesVersions name files that exist;
//   4. replays the node's multi-chain 402 (the Nov 11 capture,
//      packages/telegraph/test/fixtures/live-402-7302-multichain.json) through
//      the packaged TelegraphClient: a build without the multi-chain fix refuses
//      to sign it; a good build signs and sends X-PAYMENT;
//   5. checks the Telegraph defaults (FRAUD_RISK_GENERAL, miner 845301).
// Exits 1 on any failure. Needs network access to the npm registry.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const fromNpm = args.includes("--from-npm") ? args[args.indexOf("--from-npm") + 1] : undefined;
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const run = (cmd, argv, cwd) => execFileSync(cmd, argv, { cwd, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });

const work = mkdtempSync(join(tmpdir(), "skein-sdk-pack-"));
const problems = [];
try {
  let tarball;
  if (fromNpm) {
    tarball = join(work, run("npm", ["pack", `${pkg.name}@${fromNpm}`, "--pack-destination", work, "--silent"], work).trim().split("\n").pop());
  } else {
    if (!args.includes("--no-build")) run("pnpm", ["build"], pkgDir);
    run("pnpm", ["pack", "--pack-destination", work], pkgDir);
    tarball = join(work, readdirSync(work).find((f) => f.endsWith(".tgz")));
  }
  const app = join(work, "app");
  run("mkdir", ["-p", app], work);
  writeFileSync(join(app, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
  const viem = pkg.devDependencies?.viem ?? "2";
  run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", tarball, `viem@${viem}`], app);

  const installed = join(app, "node_modules", ...pkg.name.split("/"));
  const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  for (const field of ["main", "types"]) {
    if (!manifest[field] || !existsSync(join(installed, manifest[field]))) problems.push(`package.json ${field} (${manifest[field]}) names no file in the tarball`);
  }
  for (const [sub, conds] of Object.entries(manifest.exports ?? {})) {
    if (typeof conds !== "object") continue;
    for (const [cond, file] of Object.entries(conds)) if (!existsSync(join(installed, file))) problems.push(`exports["${sub}"].${cond} (${file}) is missing`);
  }
  for (const [sub, files] of Object.entries(manifest.typesVersions?.["*"] ?? {})) {
    for (const f of files) if (!existsSync(join(installed, f))) problems.push(`typesVersions ${sub} (${f}) is missing`);
  }
  if (!manifest.typesVersions) problems.push("no typesVersions: TypeScript with moduleResolution node10 cannot see the subpath types");

  const fixture = readFileSync(join(pkgDir, "../telegraph/test/fixtures/live-402-7302-multichain.json"), "utf8");
  writeFileSync(join(app, "fixture.json"), fixture);
  writeFileSync(
    join(app, "use.mjs"),
    `
import { readFileSync } from "node:fs";
import * as sdk from "${pkg.name}";
import { TelegraphClient, TESTNET, viemSigner } from "${pkg.name}/telegraph";
import { verifyAttestation } from "${pkg.name}/attest";
import { verifyWebhook } from "${pkg.name}/webhooks";
const out = { problems: [] };
if (typeof sdk.Skein !== "function" || typeof verifyAttestation !== "function" || typeof verifyWebhook !== "function") out.problems.push("an entry point is missing an export");
out.intent = sdk.SKEIN_INTENT;
out.minerId = sdk.SKEIN_MINER_ID ?? null;
const fx = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
let paid = 0;
const fetchImpl = async (_url, init) => {
  if (init?.headers?.["X-PAYMENT"]) {
    paid++;
    return new Response(JSON.stringify({ miner_id: "7302", result: { holders_count: 1 } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify(fx.body), { status: 402, headers: { "content-type": "application/json", "payment-required": Buffer.from(JSON.stringify(fx.paymentRequiredHeader)).toString("base64") } });
};
const client = new TelegraphClient({ network: TESTNET, signer: viemSigner("0x" + "11".repeat(32)), fetch: fetchImpl, maxUusdcPerCall: 50_000, allowPreSeason: true });
const r = await client.ask({ intent: "TOKEN_HOLDER_COUNT_GENERAL", params: { token: "0x1" } }, { minerId: "7302", timeoutMs: 5_000 });
out.multiChain402 = r.ok ? "signed" : r.kind + ": " + r.error;
out.paid = paid;
console.log(JSON.stringify(out));
`,
  );
  const used = JSON.parse(run("node", ["use.mjs"], app).trim().split("\n").pop());
  problems.push(...used.problems);
  if (used.multiChain402 !== "signed" || used.paid !== 1) problems.push(`the packaged TelegraphClient refuses the node's multi-chain 402 (${used.multiChain402}): the build lacks the multi-chain fix`);
  if (used.intent !== "FRAUD_RISK_GENERAL") problems.push(`SKEIN_INTENT is ${used.intent}, not the canonical FRAUD_RISK_GENERAL`);
  if (used.minerId !== "845301") problems.push(`SKEIN_MINER_ID is ${used.minerId}, not Skein's miner 845301`);
  console.log(`${pkg.name}@${fromNpm ?? manifest.version} (${fromNpm ? "npm" : "local pack"}): ${JSON.stringify(used)}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (problems.length) {
  console.error(`FAIL\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("ok: installs with npm, every entry point imports, and the Telegraph rail signs the current 402");
