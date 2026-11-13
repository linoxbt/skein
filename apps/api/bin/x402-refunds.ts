// pnpm --filter @skein/api x402:refunds                         list x402 refunds owed
// pnpm --filter @skein/api x402:refunds mark <key> <tx hash>    record one as sent
//
// x402 settles before Skein buys (src/x402.ts). A refusal or failure after
// settlement is owed back in full, an ABSTAIN the price less its upstream
// spend; the API records what is owed per payment and never sends money (it
// holds no key for X402_PAY_TO). The operator sends each refund from the payTo
// wallet (on testnet: test USDC on Base Sepolia) to the payer, then marks it
// here with the transfer's hash. /v1/ledger shows refundsOwedUsdc and refundsSentUsdc.
import { schema } from "@skein/db";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { connect } from "../src/db";

const [cmd, key, tx] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const { db, pool } = connect(url);
try {
  if (!cmd || cmd === "list") {
    const owed = await db
      .select({ key: schema.x402Payments.key, payer: schema.x402Payments.payer, network: schema.x402Payments.network, refundUusdc: schema.x402Payments.refundUusdc, reason: schema.x402Payments.refundReason, settledAt: schema.x402Payments.settledAt })
      .from(schema.x402Payments)
      .where(and(eq(schema.x402Payments.status, "settled"), gt(schema.x402Payments.refundUusdc, 0), isNull(schema.x402Payments.refundedAt)))
      .orderBy(desc(schema.x402Payments.settledAt));
    for (const r of owed) console.log(`${r.key}\t${r.payer}\t${r.refundUusdc / 1e6} USDC on ${r.network}\t${r.reason ?? ""}`);
    console.log(`${owed.length} refund(s) owed, ${owed.reduce((a, r) => a + r.refundUusdc, 0) / 1e6} USDC in all`);
  } else if (cmd === "mark") {
    if (!key || !tx || !/^0x[0-9a-fA-F]{64}$/.test(tx)) throw new Error("usage: x402:refunds mark <payment key> <0x tx hash>");
    const done = await db
      .update(schema.x402Payments)
      .set({ refundedAt: new Date(), refundTx: tx, updatedAt: new Date() })
      .where(and(eq(schema.x402Payments.key, key), gt(schema.x402Payments.refundUusdc, 0), isNull(schema.x402Payments.refundedAt)))
      .returning({ key: schema.x402Payments.key, refundUusdc: schema.x402Payments.refundUusdc });
    if (done.length === 0) throw new Error(`no refund owed for ${key}`);
    await db.insert(schema.spendLedger).values({ kind: "refund", amountUusdc: done[0]!.refundUusdc, ref: `${key}:${tx}` });
    console.log(`marked ${key}: ${done[0]!.refundUusdc / 1e6} USDC sent in ${tx}`);
  } else throw new Error(`unknown command ${cmd}: list or mark`);
} finally {
  await pool.end();
}
