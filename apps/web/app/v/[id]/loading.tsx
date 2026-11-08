/** Shown while a verdict page loads (the page asks the API for the verdict and its receipts). */
export default function Loading() {
  return (
    <section className="min-h-[70vh] bg-bg" aria-busy="true" aria-live="polite">
      <div className="mx-auto max-w-[1400px] px-5 pb-24 pt-40 md:px-10">
        <span className="tag tag-dark">Verdict</span>
        <p className="mt-6 font-mono text-[13px] text-muted">Loading the verdict and its receipts…</p>
      </div>
    </section>
  );
}
