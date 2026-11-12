export type Verdict = "APPROVE" | "REJECT" | "ESCALATE" | "ABSTAIN";
export type CheckStatus = "PASS" | "WARN" | "FAIL" | "UNKNOWN" | "UNAVAILABLE" | "ERROR";

export interface Subject {
  chainId: number;
  token: string;
}

export interface Finding {
  check: string;
  status: CheckStatus;
  severity: number;
  metric?: string;
  value?: number;
  unit?: string;
  confidence: number;
  sourceGroup: string;
  evidence?: { receiptHash?: string; signalHash?: string; minerId?: string };
  notes: string[];
}

/** Skein's signature over a verdict (EIP-191); check it with @skeinlabs/sdk/attest. */
export interface Attestation {
  scheme: "eip191";
  /** Skein's attester address, published at /v1/status. */
  signer: string;
  /** The exact signed text: the verdict's id, subject, outcome, policy, hashes and cost. */
  message: string;
  signature: string;
}

/** The verdict object (build spec, section 6). */
export interface VerdictObject {
  id: string;
  verdict: Verdict;
  verdictCode: number;
  riskBps: number;
  confidenceBps: number;
  coverage: number;
  summary: string;
  reasons: { code: string; check?: string; detail: string }[];
  openRisks: string[];
  conflicts: string[];
  subject: Subject;
  findings: Finding[];
  /** pricingRule: which rule set the price ("standard", or "abstain_upstream_only": an ABSTAIN costs what it bought). */
  cost: { upstreamUsdc: number; priceUsdc: number; pricingRule?: string; currency: string };
  bom: { root: string; items: number };
  /** sha256: of the policy file the verdict was made under. */
  policy: { id: string; version: string; sha256?: string };
  engineVersion: string;
  verdictHash: string;
  channel: string;
  network: string;
  createdAt: string;
  durationMs: number;
  disclaimer: string;
  cached?: boolean;
  replayed?: boolean;
  /** Set when a cached verdict answered this request: the id of the verdict served. */
  servedFrom?: string;
  /** Present when the API signs verdicts. */
  attestation?: Attestation;
}

export interface Quote {
  subject: Subject;
  policy: string;
  priceUsdc: number;
  ok: boolean;
  upstreamUsdc?: number;
  checks?: { check: string; intent: string; quoteUsdc: number }[];
  dropped?: unknown[];
  refusal?: { code: string; detail: string; checks?: string[]; quoteUusdc?: number };
}

export interface VerifyReport {
  id: string;
  ok: boolean;
  /**
   * Each step of the recomputation. attestation is present when the API signs
   * verdicts; any other key a later API adds is a boolean too.
   */
  checks: {
    adaptersRerun?: boolean;
    policyRerun?: boolean;
    bomRootRebuilt?: boolean;
    engineVersion?: boolean;
    decisionMatches?: boolean;
    receiptsMatch?: boolean;
    policyFile?: boolean;
    attestation?: boolean;
    [k: string]: boolean | undefined;
  };
  /** The network's own record of each paid answer's signal (up to 12 looked up). */
  signals?: { verified: number; missing: number; mismatch: number; unchecked: number };
  verdictHash: { stored: string; recomputed: string };
  bomRoot: { stored: string; recomputed: string };
  receipts: string[];
  problems: string[];
  /** The signer the API checked the attestation against, when it signs verdicts. */
  attester?: string;
}

export interface BomLine {
  check: string;
  intent: string;
  minerId: string | null;
  minerName: string | null;
  receiptHash: string | null;
  signalHash: string | null;
  amountUsdc: number;
  billed: boolean;
  error: string | null;
  [k: string]: unknown;
}

export interface Bom {
  id: string;
  root: string;
  items: number;
  verdictHash: string;
  lines: BomLine[];
}

/** One server-sent event of a running verdict. */
export type VerdictEvent =
  | { type: "plan"; data: { purchases?: { check: string; intent: string; quoteUusdc: number }[]; dropped?: unknown[]; [k: string]: unknown } }
  | { type: "purchase"; data: { check: string; minerId?: string; minerName?: string; amountUusdc: number; receiptHash?: string; error?: string; [k: string]: unknown } }
  | { type: "finding"; data: Finding }
  | { type: "decision"; data: { decision: { verdict: Verdict; riskBps: number; [k: string]: unknown }; verdictHash: string; [k: string]: unknown } }
  | { type: "done"; data: { id?: string; [k: string]: unknown } }
  | { type: "refused"; data: { code: string; detail: string; [k: string]: unknown } }
  | { type: "error"; data: { message: string; [k: string]: unknown } };

/** The Telegraph ask result of a paid call, as returned by any Telegraph client. */
export interface TelegraphAskOutcomeOk {
  ok: true;
  response: { miner_id: string; result: unknown; signal_hash?: string; cost_usd?: number };
  /** miner: the registration id the receipt names; checked against Skein's when present. */
  receipt: { receipt_hash: string; miner?: string } | null;
  /** Why the client does not take the receipt as evidence of this purchase. */
  receiptProblems?: string[];
  amountUusdc: number;
  durationMs: number;
}
export interface TelegraphAskOutcomeFail {
  ok: false;
  kind: string;
  error: string;
  httpStatus?: number;
  /** What was signed and sent before the failure: the node may have billed it. */
  paidUusdc?: number;
  billing?: string;
}

/** Anything that can make one paid Telegraph ask, e.g. TelegraphClient from @skeinlabs/sdk/telegraph. */
export interface TelegraphAsker {
  ask(
    req: { intent: string; params?: Record<string, unknown> },
    /** deadline: one absolute deadline (epoch ms) for the whole ask; timeoutMs bounds each request. */
    opts: { minerId?: string; timeoutMs: number; deadline?: number },
  ): Promise<TelegraphAskOutcomeOk | TelegraphAskOutcomeFail>;
}
