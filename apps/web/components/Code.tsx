/** A labelled code block: the site's terminal frame around a scrollable <pre>. */
export function Code({ label, children }: { label: string; children: string }) {
  return (
    <figure className="min-w-0 border border-edge bg-panel">
      <figcaption className="flex items-center justify-between border-b border-edge px-4 py-3 font-mono text-[12px] text-muted">
        <span>{label}</span>
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2 w-2 bg-edge" />
          <span className="h-2 w-2 bg-edge" />
          <span className="h-2 w-2 bg-thread" />
        </span>
      </figcaption>
      <pre tabIndex={0} className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed text-text">{children}</pre>
    </figure>
  );
}
