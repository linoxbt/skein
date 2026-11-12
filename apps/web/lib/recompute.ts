/**
 * Verify a verdict in the browser, without trusting the API that served it.
 *
 * Everything here is pure: the published policy file, the verdict and its
 * bill of materials go in, a list of checks comes out. The decision is rerun
 * with the frozen engine that sealed the verdict (@skein/engine, the same
 * code the API runs), the verdict hash and the receipts' Merkle root are
 * recomputed, and the EIP-191 signature is recovered and compared with the
 * attester address Skein publishes. The raw paid answers are not public, so
 * re-deriving findings from them and looking signals up on the Telegraph
 * node stay with the API's /v1/verify; the page shows that report beside
 * this one.
 */
import {
  ALL_ADAPTER_VERSIONS,
  ATTESTATION_SCHEME,
  attestationMessage,
  canonicalJson,
  ENGINES,
  evaluateWith,
  merkleRoot,
  normaliseReceipt,
  uniqueReceipts,
  type Finding as EngineFinding,
  type Policy,
  type SealedVerdict,
  type VerdictMode,
} from "@skein/engine";
import { recoverMessageAddress } from "viem";
import { parse as parseYaml } from "yaml";
import type { Bom, BomLine, VerdictObject } from "./types";

export type StepState = "pass" | "fail" | "skip";

export interface Step {
  key: "policyFile" | "engine" | "decision" | "verdictHash" | "bomRoot" | "receipts" | "attestation";
  title: string;
  state: StepState;
  detail: string;
}

export interface RecomputeInput {
  verdict: VerdictObject;
  /** The bill of materials (GET /v1/verdicts/{id}/bom). Without it the root is rebuilt from the findings' receipts. */
  bom: Pick<Bom, "lines"> & Partial<Pick<Bom, "root" | "items">> | null;
  /** The published policy file, as text. Its SHA-256 must be the one sealed in the verdict. */
  policyYaml: string | null;
  /** Skein's published attester address (GET /v1/status `attester`). */
  attester: string | null;
}

export interface RecomputeReport {
  /** True only when no step failed. A skipped step is reported as such, never as a pass. */
  ok: boolean;
  steps: Step[];
  verdictHash: { stored: string; recomputed: string | null };
  bomRoot: { stored: string; recomputed: string | null };
  /** The mode the hash matched under (sealed into it from engine 0.4.0). */
  mode: VerdictMode | null;
  recoveredSigner: string | null;
}

export const STEP_TITLES: Record<Step["key"], string> = {
  policyFile: "Policy file matched",
  engine: "Engine found",
  decision: "Decision rerun",
  verdictHash: "Verdict hash recomputed",
  bomRoot: "Receipts re-rooted",
  receipts: "Receipts accounted for",
  attestation: "Signature recovered",
};

/** SHA-256 of a string's UTF-8 bytes, hex (Web Crypto: the browser's own, and Node's). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The mode a verdict was most likely sealed under: simulated verdicts say so in their network. */
const modesToTry = (v: VerdictObject): VerdictMode[] => (v.network === "simulated" ? ["simulated", "live"] : ["live", "simulated"]);

/** Engines that sealed before the run's mode went into the hash (0.4.0). */
const MODELESS = new Set(["0.1.0", "0.2.0", "0.3.0"]);

/** Most assignments of adapter versions tried before giving up. */
const MAX_ASSIGNMENTS = 4096;

/**
 * Each finding's adapter version is part of the sealed findings, but older
 * API builds leave it out of the public verdict object. Where a finding does
 * not carry it, the candidates are, in order: the version its BOM line
 * (matched by receipt) was read with, then every version of that check's
 * adapter; a finding with no receipt may also have none (a check never
 * bought), or be the local OFAC list screen. The hash is a commitment:
 * whichever assignment reproduces it, the findings' content is what was
 * sealed; the version is metadata the page could not see.
 */
export function adapterVersionCandidates(findings: readonly EngineFinding[], lines: readonly BomLine[]): (string | undefined)[][] {
  const byReceipt = new Map(lines.filter((l) => l.receiptHash).map((l) => [normaliseReceipt(l.receiptHash!), l]));
  return findings.map((f) => {
    if (f.adapterVersion !== undefined) return [f.adapterVersion];
    const out: (string | undefined)[] = [];
    const add = (v: string | undefined) => {
      if (!out.includes(v)) out.push(v);
    };
    const r = f.evidence?.receiptHash;
    const line = r ? byReceipt.get(normaliseReceipt(r)) : undefined;
    if (line) add(line.adapterVersion);
    // An answer with a receipt was read by an adapter; anything else may be a check never bought.
    if (!r) add(undefined);
    for (const l of lines) if (l.check === f.check) add(l.adapterVersion);
    for (const a of ALL_ADAPTER_VERSIONS) if (a.check === f.check) add(a.version);
    if (f.check === "sanctions" && !r) add("ofac-sdn-1");
    return out;
  });
}

/** Assignments, most likely first: the first candidate everywhere, then one change at a time, then every combination. */
function* assignments(cands: (string | undefined)[][]): Generator<(string | undefined)[]> {
  const first = cands.map((c) => c[0]);
  let n = 0;
  yield first;
  for (let i = 0; i < cands.length; i++) {
    for (let j = 1; j < cands[i]!.length; j++) {
      if (++n > MAX_ASSIGNMENTS) return;
      const a = [...first];
      a[i] = cands[i]![j];
      yield a;
    }
  }
  const at = cands.map(() => 0);
  for (;;) {
    let i = 0;
    while (i < at.length && ++at[i]! >= cands[i]!.length) at[i++] = 0;
    if (i === at.length) return;
    if (++n > MAX_ASSIGNMENTS) return;
    yield at.map((k, x) => cands[x]![k]);
  }
}

const withVersion = (f: EngineFinding, v: string | undefined): EngineFinding => {
  const { adapterVersion: _drop, ...rest } = f;
  return v === undefined ? (rest as EngineFinding) : { ...rest, adapterVersion: v };
};

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** The receipts a verdict was sealed over: the purchase log's (its BOM lines), else those its findings carry. */
export function receiptsFor(v: VerdictObject, bom: RecomputeInput["bom"]): { receipts: string[]; from: "bom" | "findings" } {
  if (bom) return { receipts: bom.lines.map((l) => l.receiptHash).filter((r): r is string => !!r), from: "bom" };
  return { receipts: v.findings.map((f) => f.evidence?.receiptHash).filter((r): r is string => !!r), from: "findings" };
}

export async function recompute(input: RecomputeInput): Promise<RecomputeReport> {
  const { verdict: v, bom, policyYaml, attester } = input;
  const steps: Step[] = [];
  const step = (key: Step["key"], state: StepState, detail: string) => steps.push({ key, title: STEP_TITLES[key], state, detail });

  // 1. The policy file: the published bytes, hashed here.
  let source: unknown;
  if (policyYaml === null) {
    step("policyFile", "fail", `The policy file ${v.policy.id}@${v.policy.version} could not be read, so nothing can be rerun.`);
  } else {
    const sha = await sha256Hex(policyYaml);
    try {
      source = parseYaml(policyYaml);
    } catch (e) {
      source = undefined;
      step("policyFile", "fail", `The policy file is not valid YAML: ${(e as Error).message}`);
    }
    if (source !== undefined) {
      const s = source as { id?: unknown; version?: unknown };
      if (s.id !== v.policy.id || String(s.version) !== v.policy.version) {
        step("policyFile", "fail", `The file is ${String(s.id)}@${String(s.version)}, not ${v.policy.id}@${v.policy.version}.`);
        source = undefined;
      } else if (!v.policy.sha256) {
        step("policyFile", "skip", `This verdict does not name its policy file's SHA-256 (sealed before engine 0.2.0); the file hashes to ${sha.slice(0, 16)}….`);
      } else if (v.policy.sha256 !== sha) {
        step("policyFile", "fail", `The file hashes to ${sha.slice(0, 16)}…, the verdict was sealed with ${v.policy.sha256.slice(0, 16)}….`);
      } else {
        step("policyFile", "pass", `SHA-256 ${sha.slice(0, 16)}… computed here matches the one sealed in the verdict.`);
      }
    }
  }

  // 2. The engine that sealed it.
  const known = Object.hasOwn(ENGINES, v.engineVersion);
  step("engine", known ? "pass" : "fail", known ? `Engine ${v.engineVersion}, a frozen copy shipped in this page.` : `No engine ${v.engineVersion} in this page; known: ${Object.keys(ENGINES).join(", ")}.`);

  // 3–4. Rerun the decision and the hash.
  const { receipts, from } = receiptsFor(v, bom);
  let sealed: SealedVerdict | null = null;
  let mode: VerdictMode | null = null;
  if (known && source !== undefined) {
    const findings = v.findings as unknown as EngineFinding[];
    const cands = adapterVersionCandidates(findings, bom?.lines ?? []);
    const run = (fs: readonly EngineFinding[], m: VerdictMode) =>
      evaluateWith(v.engineVersion, undefined as unknown as Policy, v.subject, fs, receipts, {
        ...(v.policy.sha256 ? { policySha256: v.policy.sha256 } : {}),
        mode: m,
        policySource: source,
      });
    try {
      search: for (const m of modesToTry(v)) {
        for (const a of assignments(cands)) {
          const s = run(findings.map((f, i) => withVersion(f, a[i])), m);
          sealed ??= s;
          if (s.verdictHash === v.verdictHash) {
            sealed = s;
            mode = m;
            break search;
          }
        }
      }
    } catch (e) {
      step("decision", "fail", `The engine refused to run: ${(e as Error).message}`);
    }
  }
  if (sealed) {
    const d = sealed.decision;
    const diffs: string[] = [];
    if (d.verdict !== v.verdict) diffs.push(`verdict ${v.verdict} served, ${d.verdict} recomputed`);
    if (d.verdictCode !== v.verdictCode) diffs.push(`code ${v.verdictCode} served, ${d.verdictCode} recomputed`);
    if (d.riskBps !== v.riskBps) diffs.push(`risk ${v.riskBps} served, ${d.riskBps} recomputed`);
    if (d.confidenceBps !== v.confidenceBps) diffs.push(`confidence ${v.confidenceBps} served, ${d.confidenceBps} recomputed`);
    if (d.coverageBps !== Math.round(v.coverage * 10_000)) diffs.push(`coverage ${v.coverage} served, ${d.coverageBps / 10_000} recomputed`);
    if (canonicalJson(d.reasons) !== canonicalJson(v.reasons)) diffs.push("reasons differ");
    if (canonicalJson(d.openRisks) !== canonicalJson(v.openRisks)) diffs.push("open risks differ");
    if (canonicalJson(d.conflicts) !== canonicalJson(v.conflicts)) diffs.push("conflicts differ");
    if (sealed.summary !== v.summary) diffs.push("summary differs");
    step(
      "decision",
      diffs.length ? "fail" : "pass",
      diffs.length
        ? diffs.join("; ")
        : `${d.verdict}, risk ${d.riskBps} bps, confidence ${d.confidenceBps} bps, coverage ${d.coverageBps / 100}%: the served decision, recomputed here from the ${v.findings.length} recorded findings.`,
    );
    step(
      "verdictHash",
      mode ? "pass" : "fail",
      mode
        ? `keccak256 of the canonical findings, decision, policy and engine${MODELESS.has(v.engineVersion) ? "" : ` (sealed as ${mode})`} equals the stored hash.`
        : v.findings.some((f) => (f as { adapterVersion?: string }).adapterVersion === undefined)
          ? "No hash this page could rebuild matches. (This API build leaves each finding's adapter version out of the verdict object; every likely version was tried.)"
          : "The recomputed hash differs from the stored one.",
    );
  } else if (!steps.some((s) => s.key === "decision")) {
    step("decision", "fail", "Not rerun: the policy file or the engine is missing (see above).");
    step("verdictHash", "fail", "Not recomputed: the decision could not be rerun.");
  } else {
    step("verdictHash", "fail", "Not recomputed: the engine refused to run.");
  }

  // 5. The Merkle root over the receipts.
  let root: string | null = null;
  try {
    root = merkleRoot(receipts);
  } catch (e) {
    step("bomRoot", "fail", `A receipt is malformed: ${(e as Error).message}`);
  }
  if (root !== null) {
    const items = uniqueReceipts(receipts).length;
    const problems: string[] = [];
    if (root !== v.bom.root) problems.push("the root rebuilt here differs from the verdict's");
    if (bom?.root && bom.root !== v.bom.root) problems.push("the BOM document names another root");
    if (items !== v.bom.items) problems.push(`${items} receipts rebuilt, ${v.bom.items} sealed`);
    step(
      "bomRoot",
      problems.length ? "fail" : "pass",
      problems.length
        ? `${problems.join("; ")}${from === "findings" ? " (no BOM was given, so only the findings' receipts were used)" : ""}.`
        : `${items} receipt${items === 1 ? "" : "s"} from the ${from === "bom" ? "bill of materials" : "findings"}, rooted here (domain-separated keccak256 tree).`,
    );
  }

  // 6. Every receipt a finding cites is in the BOM.
  if (bom) {
    const inBom = new Set(bom.lines.map((l) => l.receiptHash).filter((r): r is string => !!r).map(normaliseReceipt));
    const cited = v.findings.map((f) => f.evidence?.receiptHash).filter((r): r is string => !!r).map(normaliseReceipt);
    const orphan = cited.filter((r) => !inBom.has(r));
    const unreceipted = bom.lines.filter((l) => l.billed && !l.receiptHash).length;
    step(
      "receipts",
      orphan.length || unreceipted ? "fail" : "pass",
      orphan.length || unreceipted
        ? [orphan.length ? `${orphan.length} finding receipt(s) are not in the BOM` : "", unreceipted ? `${unreceipted} billed line(s) carry no receipt` : ""].filter(Boolean).join("; ")
        : `Each of the ${cited.length} receipts the findings cite is a line of the BOM.`,
    );
  } else {
    step("receipts", "skip", "No bill of materials was given, so the findings' receipts were not matched to purchases.");
  }

  // 7. The signature, against the address Skein publishes.
  let recovered: string | null = null;
  const att = v.attestation;
  if (!att) {
    step("attestation", "skip", "This verdict carries no signature.");
  } else {
    const rebuilt = attestationMessage(v);
    try {
      recovered = await recoverMessageAddress({ message: att.message, signature: att.signature as `0x${string}` });
    } catch {
      recovered = null;
    }
    const problems: string[] = [];
    if (att.scheme !== ATTESTATION_SCHEME) problems.push(`scheme ${att.scheme}, expected ${ATTESTATION_SCHEME}`);
    if (att.message !== rebuilt) problems.push("the signed message is not the one rebuilt from the verdict's own fields");
    if (!recovered) problems.push("the signature does not recover to any address");
    else if (!same(recovered, att.signer)) problems.push(`it recovers to ${recovered}, not the signer it names`);
    if (!attester) problems.push("no published attester address to check against");
    else if (recovered && !same(recovered, attester)) problems.push(`it recovers to ${recovered}, not the published attester ${attester}`);
    step(
      "attestation",
      problems.length ? "fail" : "pass",
      problems.length ? `${problems.join("; ")}.` : `EIP-191 signature over the message rebuilt from this verdict recovers to ${recovered}, the published attester.`,
    );
  }

  return {
    ok: !steps.some((s) => s.state === "fail"),
    steps,
    verdictHash: { stored: v.verdictHash, recomputed: mode ? v.verdictHash : (sealed?.verdictHash ?? null) },
    bomRoot: { stored: v.bom.root, recomputed: root },
    mode,
    recoveredSigner: recovered,
  };
}

export interface Pasted {
  verdict: VerdictObject;
  bom: RecomputeInput["bom"];
  policyYaml: string | null;
}

/**
 * Reads pasted JSON: a verdict object on its own, or { verdict, bom,
 * policyYaml? }. A BOM document is anything with `lines`; the verdict's own
 * `bom` ({ root, items }) is not one.
 */
export function parsePasted(text: string): Pasted {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`Not JSON: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Paste a verdict object, or { verdict, bom }.");
  const o = raw as Record<string, unknown>;
  const verdict = (o.verdict && typeof o.verdict === "object" ? o.verdict : o) as Record<string, unknown>;
  for (const k of ["id", "verdict", "verdictHash", "findings", "subject", "policy", "engineVersion", "bom"]) {
    if (!(k in verdict)) throw new Error(`The verdict has no "${k}". Paste the full object from GET /v1/verdicts/{id}.`);
  }
  if (!Array.isArray(verdict.findings)) throw new Error('"findings" must be an array.');
  const bomDoc = [o.bom, verdict.bom].find((b) => b && typeof b === "object" && Array.isArray((b as { lines?: unknown }).lines)) as Bom | undefined;
  const policyYaml = typeof o.policyYaml === "string" ? o.policyYaml : null;
  return { verdict: verdict as unknown as VerdictObject, bom: bomDoc ?? null, policyYaml };
}
