// npx tsx miner/check-yaml.ts [file]   (default: skein-miner.plan-b.yaml)
//
// The free pre-registration checks from Telegraph's "Check it yourself"
// (YAML Configuration): the file parses; every key is in the schema's closed
// set (an unknown key rejects the registration); every endpoint has a
// description and only declared intents; every intent is canonical on-chain;
// and no live miner already uses the id or slug. Exits 1 on any problem.
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { createPublicClient, http, parseAbi } from "viem";
import { sepolia } from "viem/chains";
const file = process.argv[2] ?? new URL("./skein-miner.plan-b.yaml", import.meta.url).pathname;
const y = parse(readFileSync(file, "utf8"));
const TOP = new Set(["version","kind","id","slug","protocol","name","description","base_url","input_schema","output_schema","intent_mapping","polling","cache_ttl_sec","rate_limit_per_sec","circuit_threshold","circuit_cooldown_seconds","docs","errors","auth","endpoints","semantics"]);
const problems: string[] = [];
for (const k of Object.keys(y)) if (!TOP.has(k)) problems.push(`top-level key not allowed: ${k}`);
for (const k of ["version","kind","id","slug","name","base_url"]) if (y[k] === undefined) problems.push(`missing ${k}`);
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(y.slug)) problems.push("slug not kebab-case");
for (const k of Object.keys(y.auth ?? {})) if (!["type","env_var","header_name","value_prefix","inject"].includes(k)) problems.push(`auth key not allowed: ${k}`);
for (const k of Object.keys(y.semantics?.signal_mapping ?? {})) if (!["confidence_field","label_field","reason_field"].includes(k)) problems.push(`signal_mapping key not allowed: ${k}`);
const sup: string[] = y.semantics?.supported_intents ?? [];
for (const [i, e] of (y.endpoints ?? []).entries()) {
  if (!e.description) problems.push(`endpoint ${i} has no description`);
  for (const it of e.intents ?? []) if (!sup.includes(it)) problems.push(`endpoint ${i} intent ${it} not in supported_intents`);
}
const pub = createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com") });
const abi = parseAbi(["function isCanonicalIntent(string) view returns (bool)"]);
for (const it of sup) console.log(`intent ${it}: canonical=${await pub.readContract({ address: "0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b", abi, functionName: "isCanonicalIntent", args: [it] })}`);
const miners = await (await fetch("https://devnode.telegraphprotocol.com/api/miners")).json();
const list = Array.isArray(miners) ? miners : miners.miners;
console.log(`id ${y.id} / slug ${y.slug}: ${list.filter((m: any) => String(m.id) === String(y.id) || m.slug === y.slug).length} live miners use them (0 = free)`);
for (const it of sup) if (!(await pub.readContract({ address: "0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b", abi, functionName: "isCanonicalIntent", args: [it] }))) problems.push(`intent ${it} is not canonical`);
if (list.some((m: any) => String(m.id) === String(y.id) || m.slug === y.slug)) problems.push(`id ${y.id} or slug ${y.slug} is already used by a live miner`);
if (String(y.id) === "0") problems.push("id is 0: set an unused numeric id");
console.log(problems.length ? `PROBLEMS:\n${problems.join("\n")}` : "all checks passed");
process.exit(problems.length ? 1 : 0);
