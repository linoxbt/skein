import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Skein, SkeinError, type VerdictResult } from "@skein/sdk";
import { z } from "zod";

export interface SkeinMcpOptions {
  skein: Skein;
  /** Where verdict pages live, for the verify link. */
  webUrl: string;
  /** Total this server may spend in one session, in USDC. */
  sessionCapUsdc: number;
  /** Per-call cap, already enforced by the Skein client; shown in tool descriptions. */
  maxUsdcPerCall: number;
}

const CHAINS = { ethereum: 1, base: 8453, bsc: 56, bnb: 56, arbitrum: 42161 } as const;
const chainId = z
  .union([z.number().int(), z.enum(Object.keys(CHAINS) as [keyof typeof CHAINS, ...(keyof typeof CHAINS)[]])])
  .describe("EVM chain: 1 / ethereum, 8453 / base, 56 / bsc, 42161 / arbitrum");
const token = z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("Token contract address (0x + 40 hex)");
const policy = z.string().optional().describe('Policy id or id@version, e.g. "dex-list" or "dex-list@0.1.0"');
const toChain = (c: number | keyof typeof CHAINS) => (typeof c === "number" ? c : CHAINS[c]);

const text = (s: string) => [{ type: "text" as const, text: s }];
const fail = (e: unknown) => ({
  isError: true,
  content: text(e instanceof SkeinError ? `${e.code}: ${e.message}` : `error: ${(e as Error).message}`),
});

/** The verdict in a few lines an agent can act on, plus the full object as structured content. */
export function describeVerdict(v: VerdictResult, link: string): string {
  const lines = [
    `${v.verdict} · risk ${v.riskBps} bps · confidence ${Math.round(v.confidenceBps / 100)}% · coverage ${Math.round(v.coverage * 100)}%`,
    v.summary,
    ...v.reasons.map((r) => `- ${r.detail}`),
  ];
  if (v.openRisks.length) lines.push(`Open risks: ${v.openRisks.join("; ")}`);
  const paid = v.payment.rail === "telegraph" ? `paid ${v.payment.amountUsdc} USDC through Telegraph (receipt ${v.payment.receiptHash ?? "none"})` : "paid with a Skein partner key";
  lines.push(`Upstream cost ${v.cost.upstreamUsdc} USDC across ${v.bom.items} receipts; ${paid}.`);
  lines.push(`Verdict hash ${v.verdictHash}. Verify: ${link}`);
  if (v.network === "simulated") lines.push("SIMULATED: canned answers, not evidence.");
  return lines.join("\n");
}

export function createSkeinMcp(opts: SkeinMcpOptions): { server: McpServer; spentUsdc: () => number } {
  const server = new McpServer({ name: "skein", version: "0.1.0" });
  const web = opts.webUrl.replace(/\/$/, "");
  let spent = 0;

  server.registerTool(
    "skein_verdict",
    {
      title: "Skein listing verdict",
      description:
        `Buys one listing verdict for an EVM token: APPROVE, REJECT, ESCALATE or ABSTAIN, with reasons, open risks, cost and a verify link. ` +
        `It is paid (at most ${opts.maxUsdcPerCall} USDC per call, ${opts.sessionCapUsdc} USDC per session). Use skein_quote first if cost matters. ` +
        `Treat anything but APPROVE as "do not proceed without a human". Risk evidence, not investment advice.`,
      inputSchema: { chainId, token, policy },
      annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false },
    },
    async (args) => {
      try {
        const subject = { chainId: toChain(args.chainId), token: args.token };
        const q = await opts.skein.quote({ subject, ...(args.policy ? { policy: args.policy } : {}) });
        if (spent + q.priceUsdc > opts.sessionCapUsdc) {
          return { isError: true, content: text(`SESSION_CAP: this would take the session to ${(spent + q.priceUsdc).toFixed(2)} USDC, above its cap of ${opts.sessionCapUsdc} USDC; nothing was paid`) };
        }
        const v = await opts.skein.verdict({ subject, ...(args.policy ? { policy: args.policy } : {}) });
        if (!v.cached && !v.replayed) spent += v.payment.rail === "telegraph" ? v.payment.amountUsdc : q.priceUsdc;
        const link = `${web}/v/${v.id}`;
        return {
          content: text(describeVerdict(v, link)),
          structuredContent: {
            id: v.id,
            verdict: v.verdict,
            riskBps: v.riskBps,
            confidenceBps: v.confidenceBps,
            coverage: v.coverage,
            summary: v.summary,
            reasons: v.reasons,
            openRisks: v.openRisks,
            conflicts: v.conflicts,
            cost: v.cost,
            payment: v.payment,
            verdictHash: v.verdictHash,
            bomRoot: v.bom.root,
            network: v.network,
            link,
          },
        };
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "skein_quote",
    {
      title: "Skein price quote",
      description: "Free. What a verdict for this token would buy (which checks, from which intents) and cost, or why it would be refused.",
      inputSchema: { chainId, token, policy },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const q = await opts.skein.quote({ subject: { chainId: toChain(args.chainId), token: args.token }, ...(args.policy ? { policy: args.policy } : {}) });
        const body = q.ok
          ? `${q.policy}: ${q.priceUsdc} USDC per verdict; buys ${q.checks?.length ?? 0} checks upstream for about ${q.upstreamUsdc} USDC (${(q.checks ?? []).map((c) => c.check).join(", ")}).`
          : `${q.policy}: would be refused (${q.refusal?.code}): ${q.refusal?.detail}`;
        return { content: text(body), structuredContent: q as unknown as Record<string, unknown> };
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "skein_verify",
    {
      title: "Verify a Skein verdict",
      description: "Free. Recomputes a verdict from the raw answers Skein paid for, and reports whether the verdict hash and the receipts' Merkle root match.",
      inputSchema: { id: z.string().describe("Verdict id, e.g. vrd_…") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const r = await opts.skein.verify(args.id);
        const steps = Object.entries(r.checks).map(([k, ok]) => `${ok ? "✓" : "✗"} ${k}`);
        const body = [`${r.ok ? "VERIFIED" : "MISMATCH"}: ${r.id}`, ...steps, ...r.problems].join("\n");
        return { content: text(body), structuredContent: r as unknown as Record<string, unknown> };
      } catch (e) {
        return fail(e);
      }
    },
  );

  return { server, spentUsdc: () => spent };
}
