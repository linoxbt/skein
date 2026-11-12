/**
 * The ledger's charts: plain SVG bars, no chart library, with labels and
 * values as HTML text so they stay readable at any width. Verdict colours are
 * the product's fixed status colours (spec section 11), so every chart also
 * says each value in words (identity is never colour alone), and each mark
 * has a <title> for hover.
 */
import type { Verdict } from "@/lib/types";
import { VERDICT_COLOR } from "./ui";

export const VERDICT_ORDER: Verdict[] = ["APPROVE", "ESCALATE", "ABSTAIN", "REJECT"];

const row = "grid grid-cols-[minmax(84px,auto)_1fr_auto] items-center gap-4 font-mono text-[13px]";

/** One row per bucket (a day, or a window): a stacked bar of the verdict mix, on one scale, its total on the right. */
export function StackedRows({ rows, label }: { rows: { key: string; mix: Record<string, number> }[]; label: string }) {
  const totals = rows.map((r) => VERDICT_ORDER.reduce((a, v) => a + (r.mix[v] ?? 0), 0));
  const max = Math.max(1, ...totals);
  return (
    <figure className="mt-6" aria-label={label}>
      <ul className="space-y-3">
        {rows.map((r, i) => {
          let x = 0;
          return (
            <li key={r.key} className={row}>
              <span>{r.key}</span>
              <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-6 w-full" aria-hidden>
                {VERDICT_ORDER.map((v) => {
                  const n = r.mix[v] ?? 0;
                  if (!n) return null;
                  const w = (n / max) * 100;
                  const rect = (
                    <rect key={v} x={x} y={0} width={Math.max(0.3, w - 0.3)} height={10} fill={VERDICT_COLOR[v]}>
                      <title>{`${r.key}: ${v} ${n}`}</title>
                    </rect>
                  );
                  x += w;
                  return rect;
                })}
              </svg>
              <span className="text-right">{totals[i]}</span>
            </li>
          );
        })}
      </ul>
      <figcaption className="mt-3 font-mono text-[12px] text-ink-2">
        {rows.map((r) => `${r.key}: ${VERDICT_ORDER.map((v) => `${v} ${r.mix[v] ?? 0}`).join(", ")}`).join(" · ")}
      </figcaption>
    </figure>
  );
}

/** Horizontal bars on one scale, each labelled with its value (one measure: never two axes). */
export function Bars({ items, label, format = String }: { items: { key: string; value: number; color: string; note?: string }[]; label: string; format?: (n: number) => string }) {
  const max = Math.max(1e-9, ...items.map((i) => i.value));
  return (
    <figure className="mt-6" aria-label={label}>
      <ul className="space-y-3">
        {items.map((it) => (
          <li key={it.key} className={row}>
            <span className="capitalize">{it.key}</span>
            <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-6 w-full" aria-hidden>
              <rect x={0} y={0} width={it.value > 0 ? Math.max(0.5, (it.value / max) * 100) : 0} height={10} fill={it.color}>
                <title>{`${it.key}: ${format(it.value)}${it.note ? ` (${it.note})` : ""}`}</title>
              </rect>
            </svg>
            <span className="text-right">{format(it.value)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
