"use client";
import type { GraphNode, GraphState } from "@/lib/graph";
import { STATUS_COLOR, VERDICT_COLOR } from "./ui";

const W = 840;
const H = 580;
const CX = W / 2;
const CY = H / 2;
const KNOT = 42;
const R_IN = 172;
const R_OUT = 238;

const DASHED = new Set(["UNKNOWN", "UNAVAILABLE", "ERROR", "PENDING", "SKIPPED"]);
const label = (check: string) => check.replace(/_/g, " ");

/** Length of a quadratic Bezier, by sampling (precise enough for a dash animation). */
function qLength(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number): number {
  let len = 0;
  let px = x0;
  let py = y0;
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    const u = 1 - t;
    const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
    const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
    len += Math.hypot(x - px, y - py);
    px = x;
    py = y;
  }
  return Math.ceil(len);
}

interface Placed extends GraphNode {
  x: number;
  y: number;
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  angle: number;
}

function place(nodes: GraphNode[]): Placed[] {
  const n = Math.max(nodes.length, 1);
  return nodes.map((node, i) => {
    const angle = (-90 + (i * 360) / n) * (Math.PI / 180);
    const r = node.required ? R_IN : R_OUT;
    const x = CX + r * Math.cos(angle);
    const y = CY + r * Math.sin(angle);
    const sx = CX + KNOT * Math.cos(angle);
    const sy = CY + KNOT * Math.sin(angle);
    // A slight sideways bow, so threads look wound rather than ruled.
    const mx = (sx + x) / 2;
    const my = (sy + y) / 2;
    const bow = 20;
    return { ...node, angle, x, y, sx, sy, cx: mx - bow * Math.sin(angle), cy: my + bow * Math.cos(angle) };
  });
}

function detail(n: GraphNode): string {
  if (n.status === "PENDING") return "buying…";
  if (n.metric && typeof n.value === "number") {
    const v = n.unit === "USD" ? `$${Math.round(n.value).toLocaleString("en-US")}` : n.unit === "fraction" ? `${(n.value * 100).toFixed(0)}%` : n.unit === "percent" ? `${n.value}%` : n.value.toLocaleString("en-US");
    return `${n.status} · ${v}`;
  }
  return n.status;
}

export function ThreadGraph({
  state,
  selected,
  onSelect,
  live = false,
}: {
  state: GraphState;
  selected?: string | null;
  onSelect?: (check: string | null) => void;
  live?: boolean;
}) {
  const placed = place(state.nodes);
  const byCheck = new Map(placed.map((p) => [p.check, p]));
  const v = state.verdict;
  const knotColor = v ? VERDICT_COLOR[v.verdict] : "var(--color-knot)";
  const answered = state.nodes.filter((n) => n.status !== "PENDING" && n.status !== "UNAVAILABLE").length;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full select-none"
      role="group"
      aria-label={`Exploded view: ${state.nodes.length} checks${v ? `, verdict ${v.verdict}` : ""}`}
    >
      {/* rings */}
      <circle cx={CX} cy={CY} r={R_IN} fill="none" stroke="var(--color-line)" strokeDasharray="2 6" />
      <circle cx={CX} cy={CY} r={R_OUT} fill="none" stroke="var(--color-line)" strokeDasharray="2 10" opacity="0.6" />
      <text x={CX + R_IN + 6} y={CY - 6} fontSize="10" fill="var(--color-muted)" opacity="0.7">required</text>
      <text x={CX + R_OUT + 6} y={CY - 6} fontSize="10" fill="var(--color-muted)" opacity="0.7">optional</text>

      {/* threads */}
      {placed.map((p) => {
        const dashed = DASHED.has(p.status);
        const width = 1.5 + p.weight * 16;
        const len = qLength(p.sx, p.sy, p.cx, p.cy, p.x, p.y);
        return (
          <path
            key={`${p.check}-${p.status}`}
            d={`M${p.sx},${p.sy} Q${p.cx},${p.cy} ${p.x},${p.y}`}
            fill="none"
            stroke={p.status === "PENDING" ? "var(--color-thread)" : STATUS_COLOR[p.status]}
            strokeWidth={dashed ? 1.5 : width}
            strokeLinecap="round"
            strokeDasharray={dashed ? "4 6" : len}
            style={dashed ? undefined : ({ "--len": len } as React.CSSProperties)}
            className={p.status === "PENDING" ? "pending" : dashed ? "fade-in" : "thread-draw"}
            opacity={selected && selected !== p.check ? 0.35 : 0.95}
          />
        );
      })}

      {/* conflict arcs */}
      {state.conflicts.map((c) => {
        const a = byCheck.get(c.checks[0]);
        const b = byCheck.get(c.checks[1]);
        if (!a || !b || a === b) return null;
        // Bow the arc outside both rings, away from the knot.
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        let dx = mx - CX;
        let dy = my - CY;
        let len = Math.hypot(dx, dy);
        if (len < 1) {
          dx = -(b.y - a.y);
          dy = b.x - a.x;
          len = Math.hypot(dx, dy) || 1;
        }
        const qx = CX + (dx / len) * (R_OUT + 120);
        const qy = CY + (dy / len) * (R_OUT + 120);
        const lx = 0.25 * a.x + 0.5 * qx + 0.25 * b.x;
        const ly = 0.25 * a.y + 0.5 * qy + 0.25 * b.y;
        return (
          <g key={c.code} className="fade-in">
            <path d={`M${a.x},${a.y} Q${qx},${qy} ${b.x},${b.y}`} fill="none" stroke="var(--color-knot)" strokeWidth="2" />
            <rect x={lx - (c.code.length * 6.6 + 8) / 2} y={ly - 11} width={c.code.length * 6.6 + 8} height="17" fill="var(--color-bg)" stroke="var(--color-knot)" strokeWidth="1" rx="2" />
            <text x={lx} y={ly + 1} textAnchor="middle" fontSize="10" fill="var(--color-knot)">{c.code}</text>
          </g>
        );
      })}

      {/* nodes */}
      {placed.map((p) => {
        const c = Math.cos(p.angle);
        const anchor = c > 0.25 ? "start" : c < -0.25 ? "end" : "middle";
        const lx = p.x + 16 * c;
        const ly = p.y + 16 * Math.sin(p.angle) + (anchor === "middle" ? (Math.sin(p.angle) > 0 ? 8 : -12) : 0);
        const hollow = DASHED.has(p.status);
        const isSel = selected === p.check;
        return (
          <g
            key={p.check}
            role="button"
            tabIndex={0}
            aria-label={`${label(p.check)}: ${detail(p)}${p.miner ? `, ${p.miner}` : ""}`}
            aria-pressed={isSel}
            className="cursor-pointer outline-none"
            onClick={() => onSelect?.(isSel ? null : p.check)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect?.(isSel ? null : p.check);
              }
            }}
          >
            <circle cx={p.x} cy={p.y} r="16" fill="transparent" />
            {isSel ? <circle cx={p.x} cy={p.y} r="12" fill="none" stroke="var(--color-thread)" strokeWidth="1" /> : null}
            <circle
              cx={p.x}
              cy={p.y}
              r="7"
              fill={hollow ? "var(--color-bg)" : STATUS_COLOR[p.status]}
              stroke={p.status === "PENDING" ? "var(--color-thread)" : STATUS_COLOR[p.status]}
              strokeWidth="1.5"
              className={p.status === "PENDING" ? "pending" : undefined}
            />
            <text x={lx} y={ly} textAnchor={anchor} fontSize="12" fill="var(--color-text)" style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {label(p.check)}
            </text>
            <text x={lx} y={ly + 15} textAnchor={anchor} fontSize="11" fill="var(--color-muted)">
              {detail(p)}
              {typeof p.priceUsdc === "number" && p.priceUsdc > 0 ? <tspan fill="var(--color-knot)">{`  $${p.priceUsdc.toFixed(2)}`}</tspan> : null}
            </text>
          </g>
        );
      })}

      {/* the knot */}
      <circle cx={CX} cy={CY} r={KNOT + 8} fill="none" stroke={knotColor} strokeOpacity="0.25" />
      <circle cx={CX} cy={CY} r={KNOT} fill={v ? knotColor : "var(--color-bg)"} stroke={knotColor} strokeWidth="1.5" className={!v && live ? "pending" : undefined} />
      <text x={CX} y={CY + 5} textAnchor="middle" fontSize="13" fontWeight="600" fill={v ? "var(--color-bg)" : "var(--color-knot)"} style={{ fontFamily: "var(--font-sans)", letterSpacing: "0.04em" }}>
        {v ? v.verdict : live ? `${answered}/${state.nodes.length}` : "—"}
      </text>
      {v ? (
        <g fontSize="11" fill="var(--color-muted)">
          <text x={16} y={26}>risk</text>
          <text x={16} y={50} fontSize="22" fill="var(--color-text)" style={{ fontFamily: "var(--font-sans)" }}>{`${v.riskBps} bps`}</text>
          <text x={16} y={76}>{`confidence ${(v.confidenceBps / 100).toFixed(0)}%`}</text>
          <text x={16} y={94}>{`coverage ${(v.coverage * 100).toFixed(0)}%`}</text>
        </g>
      ) : null}

      {/* cost counter: gold is reserved for the verdict and its cost */}
      <text x={W - 16} y={26} textAnchor="end" fontSize="11" fill="var(--color-muted)">upstream cost</text>
      <text x={W - 16} y={50} textAnchor="end" fontSize="22" fill="var(--color-knot)" style={{ fontFamily: "var(--font-sans)" }}>
        {`$${state.costUsdc.toFixed(3)}`}
      </text>
    </svg>
  );
}
