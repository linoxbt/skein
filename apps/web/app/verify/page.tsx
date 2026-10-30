"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CornerCard } from "@/components/ui";
import { SkeinError, verify } from "@/lib/api";

type Report = Awaited<ReturnType<typeof verify>>;

const STEPS: [keyof Report["checks"] & string, string][] = [
  ["adaptersRerun", "Each paid answer re-read by its recorded adapter version"],
  ["policyRerun", "Policy rerun on the findings: same decision, same verdict hash"],
  ["bomRootRebuilt", "Bill-of-materials Merkle root rebuilt from the receipts"],
  ["engineVersion", "Engine version matches the one that made the verdict"],
];

function VerifyInner() {
  const params = useSearchParams();
  const [id, setId] = useState(params.get("id") ?? "");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(target = id) {
    if (!target) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      setReport(await verify(target.trim()));
    } catch (e) {
      setError(e instanceof SkeinError ? `${e.body.code}: ${e.body.message}` : String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const q = params.get("id");
    if (q) void run(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-sans text-[28px] font-medium">Verify</h1>
        <p className="text-muted">Recompute a stored verdict from its raw paid answers. Nothing here trusts the stored decision.</p>
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input className="min-w-0 flex-1 rounded-sm border border-line bg-surface-2 px-2 py-1.5 outline-none focus:border-thread" placeholder="vrd_…" value={id} onChange={(e) => setId(e.target.value)} aria-label="Verdict id" />
        <button type="submit" disabled={busy} className="rounded-sm border border-thread px-4 py-1.5 text-thread disabled:opacity-50">{busy ? "Checking…" : "Verify"}</button>
      </form>
      {error ? <CornerCard className="text-reject">{error}</CornerCard> : null}
      {report ? (
        <CornerCard className="space-y-4">
          <div className="font-sans text-[20px]" style={{ color: report.ok ? "var(--color-approve)" : "var(--color-reject)" }}>
            {report.ok ? "✓ Verified: every step matches" : "✗ Mismatch"}
          </div>
          <ol className="space-y-2">
            {STEPS.map(([k, text]) => (
              <li key={k} className="flex gap-3">
                <span style={{ color: report.checks[k] ? "var(--color-approve)" : "var(--color-reject)" }}>{report.checks[k] ? "✓" : "✗"}</span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
          <dl className="grid gap-y-1 text-[12px] sm:grid-cols-[160px_1fr]">
            <dt className="text-muted">verdict hash stored</dt><dd className="break-all"><code>{report.verdictHash.stored}</code></dd>
            <dt className="text-muted">recomputed</dt><dd className="break-all"><code>{report.verdictHash.recomputed}</code></dd>
            <dt className="text-muted">BOM root stored</dt><dd className="break-all"><code>{report.bomRoot.stored}</code></dd>
            <dt className="text-muted">recomputed</dt><dd className="break-all"><code>{report.bomRoot.recomputed}</code></dd>
            <dt className="text-muted">receipts</dt><dd>{report.receipts.length}</dd>
          </dl>
          {report.problems.length ? <ul className="text-[12px] text-reject">{report.problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
          <p className="text-[12px] text-muted">Re-deriving each signal hash against the Telegraph node (GET /engine/v1/signal/&#123;hash&#125;) is the next step to add.</p>
        </CornerCard>
      ) : null}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyInner />
    </Suspense>
  );
}
