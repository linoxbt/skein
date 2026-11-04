import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Skein, SkeinError, type VerdictResult } from "@skeinlabs/sdk";
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
// One plain string type in the published schema: some MCP clients (the MCP
// Inspector among them) mishandle a number-or-enum union on the first call.
// A model that sends a number (8453) still works: it is read as "8453".
const chainId = z
  .preprocess(
    (v) => (typeof v === "number" ? String(v) : typeof v === "string" ? v.trim().toLowerCase() : v),
    z.string().refine((s) => s in CHAINS || /^\d+$/.test(s), { message: "a chain name (ethereum, base, bsc, arbitrum) or a numeric chain id" }),
  )
  .describe('EVM chain: "base", "ethereum", "bsc", "arbitrum", or its id ("8453", "1", "56", "42161")');
const token = z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("Token contract address (0x + 40 hex)");
const policy = z.string().optional().describe('Policy id or id@version, e.g. "dex-list" or "dex-list@0.1.0"');
const toChain = (c: string) => (c in CHAINS ? CHAINS[c as keyof typeof CHAINS] : Number(c));

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

export function createSkeinMcp(opts: SkeinMcpOptions & { rail?: "apiKey" | "telegraph" }): { server: McpServer; spentUsdc: () => number } {
  const server = new McpServer({ name: "skein", version: "0.1.1" });
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
      const subject = { chainId: toChain(args.chainId), token: args.token };
      // Reserve before paying, so concurrent calls cannot pass the session cap together.
      // A Telegraph ask can cost more than the list price (floor x demand + fee), up to the per-call cap.
      let reserved = 0;
      try {
        const q = await opts.skein.quote({ subject, ...(args.policy ? { policy: args.policy } : {}) });
        reserved = opts.rail === "telegraph" ? Math.max(q.priceUsdc, opts.maxUsdcPerCall) : q.priceUsdc;
        if (spent + reserved > opts.sessionCapUsdc) {
          reserved = 0;
          return { isError: true, content: text(`SESSION_CAP: this would take the session to ${(spent + q.priceUsdc).toFixed(2)} USDC, above its cap of ${opts.sessionCapUsdc} USDC; nothing was paid`) };
        }
        spent += reserved;
        const v = await opts.skein.verdict({ subject, quote: q, ...(args.policy ? { policy: args.policy } : {}) });
        // Settle the reservation to what this call cost: nothing for a cache hit or a replay.
        const cost = v.cached || v.replayed ? 0 : v.payment.rail === "telegraph" ? v.payment.amountUsdc : q.priceUsdc;
        spent += cost - reserved;
        reserved = 0;
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
        // A failure keeps what was (or may have been) paid on the session's tab, and frees the rest.
        const paid = e instanceof SkeinError && e.payment ? e.payment.amountUsdc : 0;
        spent += paid - reserved;
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
