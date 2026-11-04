// node scripts/issue-partner-key.mjs <name> <agent|team|contract> <daily cap USDC> <key file>
//
// Makes a new Skein partner key. The key itself is written only to <key file>
// (mode 600) for you to hand to the partner; stdout gets the SEED_CONSUMERS
// entry, which holds only its SHA-256. Append that entry (comma-separated) to
// SEED_CONSUMERS on the Railway api service; the API reconciles consumers on
// start, so the key works after the next deploy or restart.
//
// To revoke a key later, add its hash to REVOKED_KEY_HASHES.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const [name, kind, cap, file] = process.argv.slice(2);
const usage = "usage: node scripts/issue-partner-key.mjs <name> <agent|team|contract> <daily cap USDC> <key file>";
if (!name || !kind || !cap || !file) throw new Error(usage);
if (!/^[\w .@-]{1,64}$/.test(name) || name.includes("|") || name.includes(",")) throw new Error("name: letters, digits, space, . @ _ - (no | or ,)");
if (!["agent", "team", "contract"].includes(kind)) throw new Error("kind must be agent, team or contract");
const capUsdc = Number(cap);
if (!Number.isFinite(capUsdc) || capUsdc < 0 || capUsdc > 100) throw new Error("daily cap: a number of USDC from 0 to 100");
if (existsSync(file)) throw new Error(`${file} exists; refusing to overwrite a key`);

const key = `sk_part_${randomBytes(24).toString("base64url")}`;
const hash = createHash("sha256").update(key).digest("hex");
writeFileSync(file, `${key}\n`, { mode: 0o600 });

console.log(`${name}|${kind}|${hash}|${capUsdc}`);
console.error(`key written to ${file} (mode 600). Append the line above to SEED_CONSUMERS and redeploy the api service.`);
