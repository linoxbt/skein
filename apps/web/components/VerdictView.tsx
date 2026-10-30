"use client";
import { useState } from "react";
import { short, usd } from "@/lib/api";
import type { GraphNode, GraphState } from "@/lib/graph";
import type { Bom, VerdictObject } from "@/lib/types";
import { ThreadGraph } from "./ThreadGraph";
import { CornerCard, JsonPane, ReceiptChip, StatusDot, Tabs, VerdictBadge } from "./ui";

const label = (c: string) => c.replace(/_/g, " ");

function value(n: GraphNode) {
  if (typeof n.value !== "number") return null;
  if (n.unit === "USD") return `$${Math.round(n.value).toLocaleString("en-US")}`;
  if (n.unit === "fraction") return `${(n.value * 100).toFixed(1)}%`;
  if (n.unit === "percent") return `${n.value}%`;
  return n.value.toLocaleString("en-US");
}

/** The receipt card for one thread. */
export function NodePanel({ node, verdictId }: { node: GraphNode | null; verdictId?: string }) {
  if (!node) {
    return (
      <CornerCard className="text-[12px] text-muted">
        Select a thread to see its receipt, miner, price, latency and answer.
      </CornerCard>
    );
  }
  const rows: [string, React.ReactNode][] = [
    ["status", <span key="s" className="inline-flex items-center gap-2"><StatusDot status={node.status} />{node.status}</span>],
    ["role", node.required ? "required" : "optional"],
    ["weight", node.weight.toFixed(2)],
    ...(node.metric ? ([[node.metric, value(node)]] as [string, React.ReactNode][]) : []),
    ["miner", node.miner ?? "—"],
    ["source group", node.sourceGroup ?? "—"],
    ["price", typeof node.priceUsdc === "number" ? <span key="p" className="text-knot">{usd(node.priceUsdc)}</span> : "—"],
    ["latency", typeof node.durationMs === "number" ? `${node.durationMs} ms` : "—"],
    ["confidence", typeof node.confidence === "number" ? node.confidence.toFixed(2) : "—"],
    ["receipt", <ReceiptChip key="r" hash={node.receiptHash} {...(verdictId ? { href: `/verify?id=${verdictId}` } : {})} />],
    ["signal", <ReceiptChip key="g" hash={node.signalHash} />],
    ...(node.notes?.length ? ([["notes", node.notes.join(", ")]] as [string, React.ReactNode][]) : []),
    ...(node.error ? ([["error", <span key="e" className="text-reject">{node.error}</span>]] as [string, React.ReactNode][]) : []),
  ];
  return (
    <CornerCard>
      <div className="mb-3 font-sans text-[16px] uppercase tracking-wide">{label(node.check)}</div>
      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </CornerCard>
  );
}

/** The graph becomes a list on small screens (and for screen readers it says the same). */
export function FindingList({ state, onSelect, selected }: { state: GraphState; onSelect: (c: string | null) => void; selected: string | null }) {
  return (
    <ul className="divide-y divide-line border border-line">
      {state.nodes.map((n) => (
        <li key={n.check}>
          <button
            type="button"
            onClick={() => onSelect(selected === n.check ? null : n.check)}
            className={`flex w-full items-center gap-3 px-3 py-2 text-left text-[12px] ${selected === n.check ? "bg-surface-2" : ""}`}
          >
            <StatusDot status={n.status} />
            <span className="flex-1 uppercase tracking-wide">{label(n.check)}</span>
            <span className="text-muted">{n.status === "PENDING" ? "buying…" : n.status}</span>
            {typeof n.priceUsdc === "number" && n.priceUsdc > 0 ? <span className="text-knot">{usd(n.priceUsdc)}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function GraphWithPanel({ state, live = false, verdictId }: { state: GraphState; live?: boolean; verdictId?: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const node = state.nodes.find((n) => n.check === selected) ?? null;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="hidden sm:block">
          <ThreadGraph state={state} selected={selected} onSelect={setSelected} live={live} />
        </div>
        <div className="sm:hidden">
          <FindingList state={state} selected={selected} onSelect={setSelected} />
        </div>
      </div>
      <NodePanel node={node} {...(verdictId ? { verdictId } : {})} />
    </div>
  );
}

const TABS = ["findings", "evidence", "cost", "json"] as const;

export function VerdictTabs({ v, bom }: { v: VerdictObject; bom: Bom | null }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("findings");
  return (
    <div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <div className="pt-4">
        {tab === "findings" ? (
          <div className="space-y-4">
            <ul className="space-y-1 text-[12px]">
              {v.reasons.map((r, i) => (
                <li key={i} className="flex gap-3">
                  <code className="shrink-0 text-thread">{r.code}</code>
                  <span className="text-muted">{r.detail}</span>
                </li>
              ))}
              {v.reasons.length === 0 ? <li className="text-muted">No blocking reasons.</li> : null}
            </ul>
            {v.openRisks.length ? (
              <div className="text-[12px]">
                <span className="text-muted">open risks: </span>
                {v.openRisks.join(" · ")}
              </div>
            ) : null}
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[12px]">
              <thead className="text-muted">
                <tr><th className="py-1 font-normal">check</th><th className="font-normal">status</th><th className="font-normal">severity</th><th className="font-normal">value</th><th className="font-normal">confidence</th><th className="font-normal">source</th></tr>
              </thead>
              <tbody>
                {v.findings.map((f, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="py-1.5 uppercase">{label(f.check)}</td>
                    <td><span className="inline-flex items-center gap-2"><StatusDot status={f.status} />{f.status}</span></td>
                    <td>{f.severity}</td>
                    <td>{f.metric ? `${f.metric} = ${f.value}` : "—"}</td>
                    <td>{f.confidence.toFixed(2)}</td>
                    <td className="text-muted">{f.sourceGroup}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        ) : null}
        {tab === "evidence" ? (
          <div className="space-y-3 overflow-x-auto">
            <div className="text-[12px] text-muted">
              BOM root <ReceiptChip hash={v.bom.root} href={`/verify?id=${v.id}`} /> · {v.bom.items} receipts
            </div>
            <table className="w-full min-w-[720px] text-left text-[12px]">
              <thead className="text-muted">
                <tr><th className="py-1 font-normal">check</th><th className="font-normal">miner</th><th className="font-normal">receipt</th><th className="font-normal">signal</th><th className="font-normal">price</th><th className="font-normal">latency</th><th className="font-normal">result</th></tr>
              </thead>
              <tbody>
                {(bom?.lines ?? []).map((l, i) => (
                  <tr key={i} className="border-t border-line align-top">
                    <td className="py-1.5 uppercase">{label(l.check)}</td>
                    <td>{l.minerName ?? l.minerId ?? "routed"}{l.pinned ? <span className="text-muted"> · pinned</span> : null}</td>
                    <td><ReceiptChip hash={l.receiptHash} /></td>
                    <td>{l.signalHash ? <code title={l.signalHash}>{short(l.signalHash)}</code> : "—"}</td>
                    <td className="text-knot">{l.billed ? usd(l.amountUsdc) : <span className="text-muted">not billed</span>}</td>
                    <td>{l.durationMs} ms{l.attempts > 1 ? ` · ${l.attempts} tries` : ""}</td>
                    <td className={l.error ? "text-reject" : "text-muted"}>{l.error ?? `HTTP ${l.httpStatus ?? "—"}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {tab === "cost" ? (
          <dl className="grid max-w-md grid-cols-[1fr_auto] gap-y-2 text-[12px]">
            <dt className="text-muted">upstream (paid inputs)</dt><dd className="text-knot">{usd(v.cost.upstreamUsdc)}</dd>
            <dt className="text-muted">price of this verdict</dt><dd>{usd(v.cost.priceUsdc)}</dd>
            <dt className="text-muted">receipts billed</dt><dd>{bom?.lines.filter((l) => l.billed).length ?? v.bom.items}</dd>
            <dt className="text-muted">attempts not billed</dt><dd>{bom?.lines.filter((l) => !l.billed).length ?? 0}</dd>
            <dt className="text-muted">duration</dt><dd>{(v.durationMs / 1000).toFixed(1)} s</dd>
          </dl>
        ) : null}
        {tab === "json" ? <JsonPane value={v} /> : null}
      </div>
    </div>
  );
}

export function VerdictHeader({ v }: { v: VerdictObject }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <VerdictBadge verdict={v.verdict} size="lg" />
        <code className="text-[12px] text-muted">{v.id}</code>
        <span className="text-[12px] text-muted">{v.policy.id}@{v.policy.version}</span>
        {v.cached ? <span className="text-[12px] text-thread">cached</span> : null}
      </div>
      <p className="font-sans text-[16px]">{v.summary}</p>
      <div className="text-[12px] text-muted">
        <code className="break-all">{v.subject.token}</code> on chain {v.subject.chainId} · {new Date(v.createdAt).toLocaleString()} · hash <code title={v.verdictHash}>{short(v.verdictHash)}</code>
      </div>
    </div>
  );
}
