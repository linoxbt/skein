export const CHECKS = [
  "contract_audit",
  "holder_concentration",
  "holder_count",
  "sanctions",
  "wash_trading",
  "liquidity_depth",
  "social_bots",
  "code_review",
] as const;
export type Check = (typeof CHECKS)[number];

export const STATUSES = ["PASS", "WARN", "FAIL", "UNKNOWN", "UNAVAILABLE", "ERROR"] as const;
export type FindingStatus = (typeof STATUSES)[number];

/** Statuses that count as a real answer: they carry risk and add coverage. */
export const ANSWERED: ReadonlySet<FindingStatus> = new Set(["PASS", "WARN", "FAIL"]);

export type Severity = 0 | 1 | 2 | 3; // none, low, high, critical

export interface Evidence {
  receiptHash?: string;
  signalHash?: string;
  minerId?: string;
  minerRank?: number;
}

/** The normalised unit every upstream answer becomes. */
export interface Finding {
  check: Check;
  status: FindingStatus;
  severity: Severity;
  /** Name of the measured field, e.g. "top10_holders_pct". Thresholds only apply when it matches. */
  metric?: string;
  value?: number;
  unit?: string;
  /** 0..1, from the miner's confidence field or the adapter's default. */
  confidence: number;
  /** Upstream provider family, for independence. */
  sourceGroup: string;
  evidence?: Evidence;
  /** Short machine reasons from a fixed vocabulary; never free text from a miner. */
  notes: string[];
  adapterVersion?: string;
}

export const VERDICTS = ["ABSTAIN", "APPROVE", "ESCALATE", "REJECT"] as const;
export type Verdict = (typeof VERDICTS)[number];

/**
 * On-chain verdict codes. Zero is ABSTAIN so an unset or default value in a
 * consuming contract can never read as APPROVE.
 */
export const VERDICT_CODES: Record<Verdict, number> = {
  ABSTAIN: 0,
  APPROVE: 1,
  ESCALATE: 2,
  REJECT: 3,
};

export interface Subject {
  chainId: number;
  /** Lowercase 0x-prefixed address. */
  token: string;
}

export interface Reason {
  code: string;
  check?: Check;
  detail: string;
}

export interface Decision {
  verdict: Verdict;
  verdictCode: number;
  riskBps: number;
  confidenceBps: number;
  coverageBps: number;
  reasons: Reason[];
  openRisks: string[];
  conflicts: string[];
}
