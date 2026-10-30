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
  evidence?: { receiptHash?: string; signalHash?: string; minerId?: string };
  notes: string[];
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
  cost: { upstreamUsdc: number; priceUsdc: number; currency: string };
  bom: { root: string; items: number };
  policy: { id: string; version: string };
  engineVersion: string;
  verdictHash: string;
  channel: string;
  network: string;
  createdAt: string;
  durationMs: number;
  disclaimer: string;
  cached?: boolean;
  replayed?: boolean;
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
