import type { Subject, Verdict } from "@skein/sdk";

export const EXCHANGE = "Halyard Exchange";

/** What the exchange does with each verdict: its house rule. */
export type Action = "shortlist" | "decline" | "analyst";
export const RULE: Record<Verdict, Action> = {
  APPROVE: "shortlist",
  REJECT: "decline",
  ESCALATE: "analyst",
  ABSTAIN: "analyst",
};

export interface Decision {
  at: string;
  action: Action;
  /** null when Skein refused to make a verdict (the refusal says why). */
  verdict: Verdict | null;
  verdictId: string | null;
  summary: string;
  reasons: string[];
  openRisks: string[];
  rail: "apiKey" | "telegraph" | "none";
  /** What the Desk paid for this verdict. */
  paidUsdc: number;
  /** Skein's list price for a verdict. */
  listPriceUsdc: number;
  /** What Skein paid upstream for the evidence behind it. */
  upstreamUsdc: number;
  receipts: number;
  receiptHash: string | null;
  verdictHash: string | null;
  network: string | null;
  /** From application received to decision. */
  seconds: number;
  letter: string;
  refusal?: { code: string; message: string };
}

export interface Application {
  id: string;
  receivedAt: string;
  source: "form" | "webhook";
  project: string;
  subject: Subject;
  context: { deployer?: string; social?: string; repo?: string };
  contact?: string;
  status: "received" | "buying" | "decided";
  rail?: "apiKey" | "telegraph";
  verdictId?: string;
  startedAt?: string;
  decision?: Decision;
}

export type Column = "incoming" | "shortlist" | "analyst" | "declined";
export function columnOf(a: Application): Column {
  if (a.status !== "decided" || !a.decision) return "incoming";
  return a.decision.action === "shortlist" ? "shortlist" : a.decision.action === "decline" ? "declined" : "analyst";
}

export const CHAINS: Record<number, string> = { 1: "Ethereum", 8453: "Base", 56: "BNB", 42161: "Arbitrum" };
