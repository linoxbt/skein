import { keccak256, toHex, verifyMessage } from "viem";
import { TESTNET } from "../config";
import { fillTemplate, MAX_WINDOW_SEC, type Authorization } from "../escrow";

/**
 * An in-memory Telegraph node for tests. It enforces the escrow rules from
 * the docs (network, Diamond, exact amount, a window of at most 2 minutes,
 * single-use nonces, an EIP-191 signature by authorization.from) and bills
 * only answered calls.
 */

export type Behaviour =
  | { kind: "answer"; result: unknown; resultShape?: "intent" | "raw"; status?: number; delayMs?: number }
  | { kind: "status"; status: number; body?: unknown }
  | { kind: "hang" };

export interface FakeNodeOptions {
  priceUusdc?: number;
  /** Decides what a paid call returns, per miner id ("" for routed) and body. */
  respond: (minerId: string, body: Record<string, unknown>, callNo: number) => Behaviour | Promise<Behaviour>;
  nowSec?: () => number;
}

export interface Charge {
  minerId: string;
  payer: string;
  amountUusdc: number;
  receiptHash: string;
  nonce: string;
}

const RESOURCE = "/v1/ask";

function template(amount: number): string {
  return [
    "Telegraph Escrow Payment",
    "",
    "Wallet: {from}",
    `Pay To: ${TESTNET.diamond.toLowerCase()}`,
    `Network: ${TESTNET.caip2}`,
    `Amount: ${amount} uUSDC`,
    `Resource: ${RESOURCE}`,
    "Nonce: {nonce}",
    "Valid After: {validAfter}",
    "Valid Before: {validBefore}",
  ].join("\n");
}

export class FakeNode {
  readonly charges: Charge[] = [];
  readonly refusals: string[] = [];
  private readonly usedNonces = new Set<string>();
  private calls = new Map<string, number>();
  private readonly price: number;

  constructor(private readonly opts: FakeNodeOptions) {
    this.price = opts.priceUusdc ?? 10_000;
  }

  private challenge() {
    const accept = {
      scheme: "escrow",
      network: TESTNET.caip2,
      price: `$${(this.price / 1e6).toFixed(2)}`,
      payTo: TESTNET.diamond,
      extra: { resource: RESOURCE, signWith: "personal_sign (EIP-191)", message: template(this.price) },
    };
    const full = { x402Version: 2, error: "Payment required", accepts: [accept] };
    return new Response(JSON.stringify({ error: "payment required", accepts: [accept] }), {
      status: 402,
      headers: { "content-type": "application/json", "payment-required": Buffer.from(JSON.stringify(full)).toString("base64") },
    });
  }

  private refuse(reason: string): Response {
    this.refusals.push(reason);
    return new Response(JSON.stringify({ reason, accepts: [] }), { status: 402, headers: { "content-type": "application/json" } });
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const m = url.pathname.match(/^\/engine\/v1\/ask(?:\/([^/]+))?$/);
    if (!m || init?.method !== "POST") return new Response("not found", { status: 404 });
    const minerId = m[1] ?? "";
    const headers = new Headers(init.headers);
    const payment = headers.get("x-payment");
    if (!payment) return this.challenge();

    let env: { scheme: string; network: string; payload: { signature: `0x${string}`; authorization: Authorization } };
    try {
      env = JSON.parse(Buffer.from(payment, "base64").toString("utf8"));
    } catch {
      return this.refuse("malformed X-PAYMENT");
    }
    const a = env.payload?.authorization;
    const now = this.opts.nowSec?.() ?? Math.floor(Date.now() / 1000);
    if (env.scheme !== "escrow" || env.network !== TESTNET.caip2) return this.refuse("network or chain mismatch");
    if (a.to.toLowerCase() !== TESTNET.diamond.toLowerCase()) return this.refuse(`escrow pays the diamond at ${TESTNET.diamond}`);
    if (Number(a.value) !== this.price) return this.refuse(`costs ${this.price} uUSDC, authorization offers ${a.value}`);
    if (Number(a.validBefore) - Number(a.validAfter) > MAX_WINDOW_SEC) return this.refuse("valid for too long; the maximum is 2m0s");
    if (now < Number(a.validAfter) || now > Number(a.validBefore)) return this.refuse("expired or not valid yet");
    const message = fillTemplate(template(this.price), a);
    const valid = await verifyMessage({ address: a.from as `0x${string}`, message, signature: env.payload.signature });
    if (!valid || a.from !== a.from.toLowerCase()) return this.refuse(`signature is from someone else, not authorization.from ${a.from}`);
    if (this.usedNonces.has(`${a.from}:${a.nonce}`)) return this.refuse("nonce has already been used");
    this.usedNonces.add(`${a.from}:${a.nonce}`);

    const n = (this.calls.get(minerId) ?? 0) + 1;
    this.calls.set(minerId, n);
    const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    const b = await this.opts.respond(minerId, body, n);
    if (b.kind === "hang") {
      await new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    }
    if (b.kind === "status") {
      // Failed calls are never billed and carry no receipt.
      return new Response(JSON.stringify(b.body ?? { error: "upstream failure" }), { status: b.status });
    }
    if (b.kind !== "answer") throw new Error("unreachable");
    if (b.delayMs) await new Promise((r) => setTimeout(r, b.delayMs));
    const receiptHash = keccak256(toHex(`${a.from}:${a.nonce}`));
    this.charges.push({ minerId, payer: a.from, amountUusdc: this.price, receiptHash, nonce: a.nonce });
    const receipt = {
      receipt_hash: receiptHash, rail: "escrow", payer: a.from, miner: minerId || "routed",
      intent: body.intent, amount_uusdc: String(this.price), epoch_id: 314, settlement: "epoch", chain: "telegraph", timestamp: now,
    };
    const response = {
      miner_id: minerId || "routed", miner_name: `miner-${minerId}`, result: b.result, result_shape: b.resultShape ?? "intent",
      intent: body.intent, cost_usd: this.price / 1e6, duration_ms: 5, signal_hash: keccak256(toHex(JSON.stringify(b.result))),
    };
    return new Response(JSON.stringify(response), {
      status: b.status ?? 200,
      headers: { "content-type": "application/json", "x-payment-response": Buffer.from(JSON.stringify(receipt)).toString("base64") },
    });
  };
}
