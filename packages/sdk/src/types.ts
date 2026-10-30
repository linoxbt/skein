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
  checks: Record<string, boolean>;
  verdictHash: { stored: string; recomputed: string };
  bomRoot: { stored: string; recomputed: string };
  receipts: string[];
  problems: string[];
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
  receipt: { receipt_hash: string } | null;
  amountUusdc: number;
  durationMs: number;
}
export interface TelegraphAskOutcomeFail {
  ok: false;
  kind: string;
  error: string;
  httpStatus?: number;
}

/** Anything that can make one paid Telegraph ask, e.g. TelegraphClient from @skein/telegraph. */
export interface TelegraphAsker {
  ask(
    req: { intent: string; params?: Record<string, unknown> },
    opts: { minerId?: string; timeoutMs: number },
  ): Promise<TelegraphAskOutcomeOk | TelegraphAskOutcomeFail>;
}
