"use client";
import { lineDiff } from "@/lib/diff";

/** Two versions of one policy file, line by line: removed in red, added in teal. */
export function PolicyDiff({ before, after, fromRef, toRef }: { before: string; after: string; fromRef: string; toRef: string }) {
  let lines;
  try {
    lines = lineDiff(before, after);
  } catch {
    return <p className="font-mono text-[13px] text-muted">These files are too long to diff here.</p>;
  }
  const added = lines.filter((l) => l.kind === "add").length;
  const removed = lines.filter((l) => l.kind === "del").length;
  return (
    <figure className="min-w-0 border border-line bg-surface">
      <figcaption className="flex flex-wrap justify-between gap-3 border-b border-line px-4 py-3 font-mono text-[12px] text-muted">
        <span>
          {fromRef}.yaml → {toRef}.yaml
        </span>
        <span>
          <span className="text-thread">+{added}</span> <span className="text-reject">−{removed}</span>
        </span>
      </figcaption>
      <pre tabIndex={0} aria-label={`Changes from ${fromRef} to ${toRef}`} className="max-h-[560px] overflow-auto py-3 font-mono text-[13px] leading-relaxed">
        {lines.map((l, i) => (
          <div
            key={i}
            className={`grid grid-cols-[3.5rem_3.5rem_1.5rem_1fr] px-2 ${l.kind === "add" ? "bg-thread/10 text-thread" : l.kind === "del" ? "bg-reject/10 text-reject" : "text-muted"}`}
          >
            <span className="select-none text-right">{l.a ?? ""}</span>
            <span className="select-none text-right">{l.b ?? ""}</span>
            <span className="select-none text-center" aria-hidden>{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
            <span className="whitespace-pre-wrap break-all">
              <span className="sr-only">{l.kind === "add" ? "added: " : l.kind === "del" ? "removed: " : ""}</span>
              {l.text}
            </span>
          </div>
        ))}
      </pre>
    </figure>
  );
}
