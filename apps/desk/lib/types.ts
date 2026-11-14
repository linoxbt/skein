import type { Subject, Verdict } from "@skeinlabs/sdk";

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
  /** What the Desk paid: on Telegraph, what was signed for the ask, even when no verdict came back. */
  paidUsdc: number;
  /** "unknown": the payment was sent but the ask failed, so the node may or may not have billed it. */
  billing?: "paid" | "unknown";
  /** Skein's list price for a verdict. */
  listPriceUsdc: number;
  /** What Skein paid upstream for the evidence behind it. */
  upstreamUsdc: number;
  receipts: number;
  receiptHash: string | null;
  /** The Telegraph miner that answered (rail telegraph). */
  minerId?: string | null;
  /** The node's record of the answer, at /engine/v1/signal/{hash} (rail telegraph). */
  signalHash?: string | null;
  verdictHash: string | null;
  network: string | null;
  /** From application received to decision. */
  seconds: number;
  letter: string;
  refusal?: { code: string; message: string };
}

/**
 * One Telegraph ask, written to the application as soon as the ask returns
 * and before the verdict is fetched. A later tick can then finish a paid ask
 * whose function died, by reading the verdict (free), never by asking again.
 */
export interface AskRecord {
  at: string;
  /** "none": no payment was sent, so the ask may be made again. */
  billing: "paid" | "unknown" | "none";
  amountUsdc: number;
  minerId: string | null;
  receiptHash: string | null;
  signalHash: string | null;
  /** The verdict the miner answered with, or the one it is still making (its pending_id). */
  verdictId: string | null;
  /** Why the receipt is not evidence of this purchase; empty when it checks out. */
  receiptProblems?: string[];
  error?: string;
}

/** Where an application the agent filed itself came from. */
export interface Origin {
  feed: "dexscreener" | "sniper";
  url?: string;
}

export interface Application {
  id: string;
  receivedAt: string;
  /** form or webhook: filed by a person or a partner; agent: filed by the Desk's own intake of fresh launches. */
  source: "form" | "webhook" | "agent";
  origin?: Origin;
  project: string;
  subject: Subject;
  context: { deployer?: string; social?: string; repo?: string };
  status: "received" | "buying" | "decided";
  /** Who is working on it, until when: only the lease holder may buy or decide. */
  lease?: { by: string; until: string };
  rail?: "apiKey" | "telegraph";
  verdictId?: string;
  startedAt?: string;
  /** The Telegraph ask, once it has returned. */
  ask?: AskRecord;
  /** Telegraph asks that failed before any payment was sent; retried on later ticks, up to a limit. */
  attempts?: number;
  decision?: Decision;
  /**
   * A verdict found after the decision, for a paid Telegraph ask that came
   * back without its verdict id: read, free, from the node's public record of
   * the answer. `decision` stays exactly as it was written; this is appended
   * beside it, and the ask is never made or paid again.
   */
  recovered?: { at: string; from: "signal-record"; decision: Decision };
  /** The last recovery attempt that found no usable verdict (tried again after RECOVERY_RETRY_MS). */
  recoveryTried?: { at: string; error: string };
}

/** The decision that stands: the recovered one, when a verdict was found later, else the one first written. */
export const current = (a: Pick<Application, "decision" | "recovered">): Decision | undefined => a.recovered?.decision ?? a.decision;

export type Column = "incoming" | "shortlist" | "analyst" | "declined";
export function columnOf(a: { status: Application["status"]; decision?: { action: Action } }): Column {
  if (a.status !== "decided" || !a.decision) return "incoming";
  return a.decision.action === "shortlist" ? "shortlist" : a.decision.action === "decline" ? "declined" : "analyst";
}

export const CHAINS: Record<number, string> = { 1: "Ethereum", 8453: "Base", 56: "BNB", 42161: "Arbitrum" };
