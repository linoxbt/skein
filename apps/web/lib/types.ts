export type Verdict = "APPROVE" | "REJECT" | "ESCALATE" | "ABSTAIN";
export type Status = "PASS" | "WARN" | "FAIL" | "UNKNOWN" | "UNAVAILABLE" | "ERROR";

export interface Finding {
  check: string;
  status: Status;
  severity: number;
  metric?: string;
  value?: number;
  unit?: string;
  confidence: number;
  sourceGroup: string;
  evidence?: { receiptHash?: string; signalHash?: string; minerId?: string; minerRank?: number; list?: string; listSha256?: string };
  notes: string[];
  /** The adapter that read the answer (part of the sealed findings; absent from older API builds' verdict view). */
  adapterVersion?: string;
}

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
  subject: { chainId: number; token: string };
  findings: Finding[];
  cost: { upstreamUsdc: number; priceUsdc: number; currency: string; pricingRule?: string };
  bom: { root: string; items: number };
  /** sha256: the policy file's SHA-256, sealed into the verdict hash (engine 0.2.0 on). */
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
  /** Skein's EIP-191 signature over the verdict; /verify checks it. */
  attestation?: { scheme: "eip191"; signer: string; message: string; signature: string };
}

export interface BomLine {
  check: string;
  intent: string;
  minerId: string | null;
  minerName: string | null;
  pinned: boolean;
  rail: string;
  receiptHash: string | null;
  signalHash: string | null;
  amountUsdc: number;
  epochId: number | null;
  httpStatus: number | null;
  durationMs: number;
  attempts: number;
  sourceGroup: string;
  adapterVersion: string;
  error: string | null;
  billed: boolean;
  billing?: "paid" | "unknown" | "none";
  signalStatus?: string | null;
  /** The miner's rank in the catalogue when it was bought, where the API reports it. */
  rank?: number | null;
  /** The miner's raw answer, where the API reports it. */
  rawResult?: unknown;
  createdAt: string;
}

export interface Bom {
  id: string;
  root: string;
  items: number;
  verdictHash: string;
  lines: BomLine[];
}

export interface PolicyDoc {
  ref: string;
  sha256: string;
  yaml: string;
  policy: {
    id: string;
    version: string;
    description?: string;
    required: string[];
    optional: string[];
    weights: Record<string, number>;
    conflicts: { code: string; detail: string; when: { check: string; status: Status }[] }[];
    blockers?: { check: string; status: Status; minSeverity?: number }[];
    thresholds?: Record<string, { warn: number; fail: number; field: string }>;
    decision?: { approve_below_risk_bps: number; reject_above_risk_bps: number; min_coverage: number; min_confidence: number };
    budget?: { max_usdc: number };
  };
}

export interface PolicySummary {
  ref: string;
  id: string;
  version: string;
  sha256: string;
  description?: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}
