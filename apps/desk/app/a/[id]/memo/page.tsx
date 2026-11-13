import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { VerdictObject } from "@skeinlabs/sdk";
import { deskDeps, SKEIN_API_URL, SKEIN_WEB_URL } from "@/lib/desk";
import { CHAINS, EXCHANGE } from "@/lib/types";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Listing risk memo" };

/** The Telegraph node the Desk pays on (the same setting its client uses). */
const TELEGRAPH_NODE_URL = (process.env.TELEGRAPH_NODE_URL || "https://devnode.telegraphprotocol.com").replace(/\/$/, "");

interface BomLine {
  check: string;
  intent: string;
  minerName: string | null;
  minerId: string | null;
  receiptHash: string | null;
  amountUsdc: number;
  billed: boolean;
  error: string | null;
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${SKEIN_API_URL.replace(/\/$/, "")}${path}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

const usd = (n: number) => `${n.toFixed(n < 1 ? 4 : 2).replace(/0+$/, "").replace(/\.$/, ".00")} USDC`;
const ACTION = { shortlist: "Shortlist for listing", decline: "Decline", analyst: "Send to an analyst" } as const;

/**
 * The listing risk memo: one printable page per application, built from the
 * Desk's decision and the verdict Skein served (with its signature and bill
 * of materials), ending with the cost line.
 */
export default async function MemoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^app_[a-z0-9]{6,32}$/.test(id)) notFound();
  const a = (await (await deskDeps()).store.get(id))?.value;
  if (!a) notFound();
  const d = a.decision;
  const v = d?.verdictId ? await getJson<VerdictObject>(`/v1/verdicts/${encodeURIComponent(d.verdictId)}`) : null;
  const bom = d?.verdictId ? await getJson<{ lines: BomLine[] }>(`/v1/verdicts/${encodeURIComponent(d.verdictId)}/bom`) : null;
  const lines = bom?.lines ?? [];
  const row = "grid grid-cols-[150px_minmax(0,1fr)] gap-4 border-t border-rule py-2.5 text-[14px] md:grid-cols-[190px_minmax(0,1fr)]";

  return (
    // A div: the root layout already wraps every page in <main>.
    <div className="memo bg-paper text-ink">
      <style>{`@media print {
        body > header, body header.fixed, footer, .no-print { display: none !important }
        html, body, main, .memo { background: #fff !important }
        main, .memo { padding: 0 !important }
        .memo-scroll { overflow: visible !important }
        .memo-table { min-width: 0 !important; table-layout: fixed }
        .memo-table td, .memo-table th { word-break: break-all }
        @page { size: A4; margin: 14mm }
      }`}</style>
      <article className="mx-auto max-w-[860px] px-5 pb-20 pt-28 md:px-10 md:pt-36 print:pt-0">
        <div className="no-print mb-10 flex flex-wrap gap-0">
          <PrintButton />
          <Link href={`/a/${id}`} className="btn btn-light border border-rule">← Back to the application</Link>
        </div>

        <div className="border-b-2 border-ink pb-6">
          <p className="font-mono text-[12px] uppercase tracking-wider text-ink-2">{EXCHANGE} · Listing risk memo</p>
          <h1 className="mt-3 text-[34px] font-medium leading-tight md:text-[44px]">{a.project}</h1>
          <p className="mt-2 break-all font-mono text-[13px] text-ink-2">
            {CHAINS[a.subject.chainId]} · {a.subject.token} · application {a.id} · received {new Date(a.receivedAt).toUTCString()}
          </p>
        </div>

        {!d ? (
          <p className="mt-10 text-[17px]">Not decided yet. The agent is still buying the evidence; reload in a minute.</p>
        ) : (
          <>
            <section className="mt-8 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
              <div>
                <p className="font-mono text-[12px] uppercase tracking-wider text-ink-2">Recommendation</p>
                <p className="mt-1 text-[28px] font-medium">{ACTION[d.action]}</p>
                <p className="mt-3 text-[17px] leading-relaxed text-ink-2">{d.summary}</p>
              </div>
              <div className="font-mono text-[13px] md:text-right">
                <div>verdict <b>{d.verdict ?? "refused"}</b></div>
                {v ? <div>risk {v.riskBps} bps · confidence {Math.round(v.confidenceBps / 100)}% · coverage {Math.round(v.coverage * 100)}%</div> : null}
                <div>decided in {d.seconds}s</div>
              </div>
            </section>

            {d.reasons.length ? (
              <section className="mt-8">
                <h2 className="font-mono text-[12px] uppercase tracking-wider text-ink-2">Reasons</h2>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px]">{d.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              </section>
            ) : null}
            {d.openRisks.length ? (
              <section className="mt-6">
                <h2 className="font-mono text-[12px] uppercase tracking-wider text-ink-2">Open risks (not settled by this evidence)</h2>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px]">{d.openRisks.map((r) => <li key={r}>{r}</li>)}</ul>
              </section>
            ) : null}

            <section className="mt-8">
              <h2 className="font-mono text-[12px] uppercase tracking-wider text-ink-2">Evidence bought through Telegraph</h2>
              {lines.length ? (
                <div className="memo-scroll mt-2 overflow-x-auto">
                  <table className="memo-table w-full min-w-[620px] border-collapse text-left text-[13px]">
                    <thead>
                      <tr className="border-b border-ink font-mono text-[11px] uppercase tracking-wider text-ink-2">
                        <th className="py-2 pr-3 font-normal">Check</th>
                        <th className="py-2 pr-3 font-normal">Miner</th>
                        <th className="py-2 pr-3 font-normal">Receipt</th>
                        <th className="py-2 text-right font-normal">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => (
                        <tr key={`${l.check}-${i}`} className="border-b border-rule align-top">
                          <td className="py-2 pr-3">{l.check}<div className="font-mono text-[11px] text-ink-2">{l.intent}</div></td>
                          <td className="py-2 pr-3">{l.minerName ?? l.minerId ?? "—"}{l.error ? <div className="text-[12px] text-reject-deep">{l.error}</div> : null}</td>
                          <td className="break-all py-2 pr-3 font-mono text-[11px]">{l.receiptHash ?? (l.billed ? "—" : "not billed")}</td>
                          <td className="py-2 text-right font-mono">{usd(l.amountUsdc)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-2 text-[15px] text-ink-2">No paid inputs: {d.verdict === "ABSTAIN" ? "the checks could not be bought, so Skein abstained and charged upstream cost only." : "see the verdict page."}</p>
              )}
            </section>

            <section className="mt-8">
              <h2 className="font-mono text-[12px] uppercase tracking-wider text-ink-2">Verification</h2>
              <div className="mt-2">
                <div className={row}><span className="text-ink-2">Verdict</span><span className="break-all font-mono">{d.verdictId ?? "—"}</span></div>
                <div className={row}><span className="text-ink-2">Verdict hash</span><span className="break-all font-mono">{d.verdictHash ?? "—"}</span></div>
                {v ? <div className={row}><span className="text-ink-2">Receipts root</span><span className="break-all font-mono">{v.bom.root} ({v.bom.items})</span></div> : null}
                {v ? <div className={row}><span className="text-ink-2">Policy · engine</span><span className="font-mono">{v.policy.id}@{v.policy.version} · {v.engineVersion}</span></div> : null}
                <div className={row}><span className="text-ink-2">Network</span><span className="font-mono">{d.network ?? "—"} (Telegraph testnet payments; mainnet tokens analysed)</span></div>
                {d.rail === "telegraph" ? (
                  <>
                    <div className={row}><span className="text-ink-2">Bought from</span><span className="break-all font-mono">Telegraph miner {d.minerId ?? "unknown"}</span></div>
                    <div className={row}>
                      <span className="text-ink-2">Desk&apos;s receipt</span>
                      <span className="break-all font-mono">
                        {d.receiptHash ?? "none returned"}
                        {d.signalHash ? <a className="no-print ml-2 underline underline-offset-4" href={`${TELEGRAPH_NODE_URL}/engine/v1/signal/${d.signalHash}`}>the node&apos;s record</a> : null}
                      </span>
                    </div>
                  </>
                ) : null}
                {v?.attestation ? (
                  <>
                    <div className={row}><span className="text-ink-2">Signed by</span><span className="break-all font-mono">{v.attestation.signer} (Skein, EIP-191)</span></div>
                    <div className={row}><span className="text-ink-2">Signature</span><span className="break-all font-mono text-[12px]">{v.attestation.signature}</span></div>
                  </>
                ) : (
                  <div className={row}><span className="text-ink-2">Signature</span><span className="text-ink-2">not signed (the API has no attestation key set)</span></div>
                )}
                {d.verdictId ? (
                  <div className={row}><span className="text-ink-2">Check it</span><span className="break-all">{SKEIN_WEB_URL}/verify?id={d.verdictId}</span></div>
                ) : null}
              </div>
              {v?.attestation ? (
                <details className="no-print mt-3 text-[13px]">
                  <summary className="cursor-pointer text-ink-2">The signed message</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-all bg-mist p-4 font-mono text-[12px]">{v.attestation.message}</pre>
                </details>
              ) : null}
              {v?.attestation ? (
                <div className="hidden print:block">
                  <p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-ink-2">The signed message (EIP-191)</p>
                  <pre className="mt-1 whitespace-pre-wrap break-all border border-rule p-3 font-mono text-[10px]">{v.attestation.message}</pre>
                </div>
              ) : null}
            </section>

            <section className="mt-10 border-y-2 border-ink py-4">
              <h2 className="font-mono text-[12px] uppercase tracking-wider text-ink-2">Cost</h2>
              <div className="mt-2 grid gap-x-6 gap-y-1 font-mono text-[14px] sm:grid-cols-2">
                <span>Evidence bought upstream</span><span className="sm:text-right">{usd(d.upstreamUsdc)} across {d.receipts} receipt{d.receipts === 1 ? "" : "s"}</span>
                <span>Skein&apos;s price for this verdict</span><span className="sm:text-right">{usd(v?.cost.priceUsdc ?? d.listPriceUsdc)} (list {usd(d.listPriceUsdc)}{v?.cost.priceUsdc === 0 && d.listPriceUsdc > 0 ? "; ABSTAIN is charged upstream cost only" : ""})</span>
                <span className="font-medium">The desk paid</span>
                <span className="font-medium sm:text-right">
                  {d.billing === "unknown" ? `${d.paidUsdc > 0 ? `up to ${usd(d.paidUsdc)}` : "an unknown amount"}` : usd(d.paidUsdc)}{" "}
                  {d.rail === "telegraph"
                    ? d.billing === "unknown"
                      ? "from its Telegraph escrow (the payment was sent but the ask failed; never asked again)"
                      : "from its Telegraph escrow"
                    : d.rail === "apiKey"
                      ? d.paidUsdc === 0 ? "(Skein partner key: free during the hackathon)" : "with a Skein partner key"
                      : "(refused before any purchase)"}
                </span>
                <span>Time from application to decision</span><span className="sm:text-right">{d.seconds} s</span>
              </div>
            </section>
            <p className="mt-4 text-[12px] text-ink-2">Risk evidence for a listing decision, not investment advice. Anything but APPROVE goes to a human.</p>
          </>
        )}
      </article>
    </div>
  );
}
