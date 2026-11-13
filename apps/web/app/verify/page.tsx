"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { IconCheck, IconCross } from "@skein/ui";
import { Lead, PageHero, Section } from "@skein/ui";
import { tabIds, Tabs } from "@/components/ui";
import { getBom, getPolicy, getVerdict, sharedStatus, short, SkeinError, verify, type VerifyReport } from "@/lib/api";
import { parsePasted, recompute, type RecomputeReport, type StepState } from "@/lib/recompute";

const MODES = ["by id", "paste json"] as const;
type Mode = (typeof MODES)[number];

/** What the API's /v1/verify checks, in words. Newer API builds add checks; unknown keys are shown by name. */
const SERVER_CHECKS: Record<string, string> = {
  adaptersRerun: "Findings re-derived from the raw paid answers, with the adapter version recorded for each",
  policyRerun: "Decision rerun and verdict hash matched",
  bomRootRebuilt: "BOM Merkle root rebuilt from the purchase log",
  engineVersion: "The engine that sealed it is still shipped",
  decisionMatches: "The served decision is the recomputed one",
  receiptsMatch: "BOM receipts are exactly the purchases' receipts",
  policyFile: "The policy file is the published one",
  attestation: "Signature checked by the API",
  signals: "Each paid answer's signal found on the Telegraph node",
  unpurchased: "Findings without a purchase are non-answers or a known list screen",
  unpurchasedFindings: "Findings without a purchase are non-answers or a known list screen",
};
const human = (k: string) => SERVER_CHECKS[k] ?? k.replace(/([A-Z])/g, " $1").toLowerCase();

interface Result {
  id: string | null;
  client: RecomputeReport;
  server: VerifyReport | null;
  serverError: string | null;
  attester: string | null;
  attesterFrom: string;
}

function Mark({ state }: { state: StepState }) {
  const cls = state === "pass" ? "bg-thread-deep" : state === "fail" ? "bg-reject-deep" : "bg-abstain-deep";
  return (
    <span className={`grid h-12 w-12 shrink-0 place-items-center text-white ${cls}`} aria-label={state === "pass" ? "passed" : state === "fail" ? "failed" : "not checked"}>
      {state === "pass" ? <IconCheck size={26} /> : state === "fail" ? <IconCross size={26} /> : <span className="font-mono text-[20px]">–</span>}
    </span>
  );
}

/** The signals the API looked up: a mismatch or a missing signal fails; a node that did not answer is "not checked". */
function signalsState(s: VerifyReport["signals"]): StepState {
  if (!s) return "skip";
  if (s.mismatch > 0 || s.missing > 0) return "fail";
  return s.verified > 0 ? "pass" : "skip";
}

function VerifyInner() {
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>("by id");
  const [id, setId] = useState(params.get("id") ?? "");
  const [pasted, setPasted] = useState("");
  const [attesterInput, setAttesterInput] = useState("");
  const [published, setPublished] = useState<string | null | undefined>(undefined);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    sharedStatus()
      .then((s) => setPublished(s.attester ?? null))
      .catch(() => setPublished(null));
  }, []);
  const attester = attesterInput.trim() || published || null;
  const attesterFrom = attesterInput.trim() ? "typed in above" : published ? "published at /v1/status" : "none: /v1/status did not name one";

  async function policyText(ref: string, given: string | null) {
    if (given !== null) return given;
    // Fetched from the API, but not trusted: its SHA-256 is checked here against the one sealed in the verdict.
    return getPolicy(ref).then((p) => p.yaml).catch(() => null);
  }

  async function runId(target = id) {
    const vid = target.trim();
    if (!vid) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const [v, bom, server] = await Promise.all([
        getVerdict(vid),
        getBom(vid).catch(() => null),
        verify(vid).then(
          (r) => ({ r, e: null }),
          (e) => ({ r: null, e: e instanceof SkeinError ? `${e.body.code}: ${e.body.message}` : String(e) }),
        ),
      ]);
      if ("status" in v) throw new Error("This verdict is still running. Verify it once it is sealed.");
      const yaml = await policyText(`${v.policy.id}@${v.policy.version}`, null);
      const client = await recompute({ verdict: v, bom, policyYaml: yaml, attester });
      setResult({ id: v.id, client, server: server.r, serverError: server.e, attester, attesterFrom });
    } catch (e) {
      setError(e instanceof SkeinError ? `${e.body.code}: ${e.body.message}` : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runPaste() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const p = parsePasted(pasted);
      const yaml = await policyText(`${p.verdict.policy.id}@${p.verdict.policy.version}`, p.policyYaml);
      const client = await recompute({ verdict: p.verdict, bom: p.bom, policyYaml: yaml, attester });
      setResult({ id: null, client, server: null, serverError: null, attester, attesterFrom });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const q = params.get("id");
    if (q && published !== undefined) void runId(q);
    // Once the published attester is known (or known to be missing).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [published === undefined]);

  const serverOk = result?.server ? result.server.ok : null;
  const ok = result ? result.client.ok && serverOk !== false : false;

  return (
    <>
      <PageHero
        compact
        tag="Verify"
        title={<>Don&apos;t trust.<br />Recompute.</>}
        sub="Your browser reruns the verdict with the same frozen engine that sealed it: the policy file's hash, the decision, the verdict hash, the receipts' Merkle root and the signature. The API's own replay, which can read the raw paid answers, is shown beside it."
        actions={
          <div className="w-full max-w-3xl">
            <Tabs tabs={MODES} value={mode} onChange={setMode} idPrefix="verify" />
            <div role="tabpanel" id={tabIds("verify", mode).panel} aria-labelledby={tabIds("verify", mode).tab} className="border border-line bg-surface p-4">
              {mode === "by id" ? (
                <form
                  className="flex flex-col sm:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runId();
                  }}
                >
                  <input className="field !h-12 flex-1" placeholder="vrd_…" value={id} onChange={(e) => setId(e.target.value)} aria-label="Verdict id" />
                  <button type="submit" disabled={busy || published === undefined} className="btn btn-primary">{busy ? "Recomputing…" : "Verify"}</button>
                </form>
              ) : (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runPaste();
                  }}
                >
                  <textarea
                    className="field !h-48 w-full py-3"
                    placeholder='{ "verdict": { … }, "bom": { "lines": [ … ] }, "policyYaml": "…" }   or a bare verdict object'
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    aria-label="Verdict JSON"
                    spellCheck={false}
                  />
                  <p className="font-mono text-[12px] text-muted">
                    Checked entirely in this tab. Without a <code>policyYaml</code> the policy file is fetched from the API and checked against the
                    SHA-256 in the verdict; without a <code>bom</code> the root is rebuilt from the findings&apos; receipts.
                  </p>
                  <button type="submit" disabled={busy || !pasted.trim()} className="btn btn-primary">{busy ? "Recomputing…" : "Verify pasted JSON"}</button>
                </form>
              )}
              <label className="mt-4 block font-mono text-[12px] text-muted">
                attester address the signature must recover to
                <input
                  className="field mt-2"
                  placeholder={published ?? "0x… (the API did not publish one)"}
                  value={attesterInput}
                  onChange={(e) => setAttesterInput(e.target.value)}
                  aria-describedby="attester-note"
                />
              </label>
              <p id="attester-note" className="mt-2 font-mono text-[12px] text-muted" data-testid="published-attester">
                Published attester: <span className="break-all text-text">{published === undefined ? "reading /v1/status…" : (published ?? "none published")}</span>
              </p>
            </div>
          </div>
        }
      />

      {error ? (
        <Section tone="dark" inner="pb-24">
          <div role="alert" className="border border-reject/50 bg-reject/10 p-6 font-mono text-[14px] text-reject">{error}</div>
        </Section>
      ) : null}

      {result ? (
        <>
          <Section tone="paper" inner="py-16 md:py-24">
            <Lead tag={ok ? "Verified" : "Mismatch"} />
            <h2 className="display mt-4 text-[48px] md:text-[96px]" style={{ color: ok ? "var(--color-thread-deep)" : "var(--color-reject-deep)" }}>
              {ok ? "Every step matches." : result.client.ok ? "The API's replay reports a problem." : "Something changed."}
            </h2>
            <h3 className="mt-12 font-mono text-[13px] uppercase tracking-wider text-ink-2">Recomputed in your browser</h3>
            <ol className="mt-2" data-testid="client-steps">
              {result.client.steps.map((s, i, all) => (
                <li key={s.key} className="rise" style={{ animationDelay: `${i * 100}ms` }} data-state={s.state}>
                  <div className="grid grid-cols-[1fr_auto] items-center gap-6 py-5">
                    <div>
                      <h4 className="statement text-[24px] md:text-[36px]">{s.title}</h4>
                      <p className="mt-1 break-words text-ink-2">{s.detail}</p>
                    </div>
                    <Mark state={s.state} />
                  </div>
                  {i < all.length - 1 ? <div className="rule-dots" /> : null}
                </li>
              ))}
            </ol>
            <p className="mt-6 font-mono text-[12px] text-ink-2">
              Attester checked against: <span className="break-all">{result.attester ?? "none"}</span> ({result.attesterFrom})
              {result.client.recoveredSigner ? <> · signature recovers to <span className="break-all">{result.client.recoveredSigner}</span></> : null}
            </p>
          </Section>

          {result.id ? (
            <Section tone="mist" inner="py-16 md:py-20">
              <h3 className="font-mono text-[13px] uppercase tracking-wider text-ink-2">The API&apos;s own replay · POST /v1/verify</h3>
              {result.server ? (
                <>
                  <p className="mt-3 max-w-3xl text-ink-2">
                    The API also re-reads the raw paid answers with the recorded adapters (it returns them under <code>inputs</code>), matches
                    receipts to its purchase log, and looks each signal up on the Telegraph node. Its report, as it answered:{" "}
                    <strong className={result.server.ok ? "text-thread-deep" : "text-reject-deep"}>{result.server.ok ? "ok" : "not ok"}</strong>.
                  </p>
                  <ul className="mt-6 grid gap-px bg-rule md:grid-cols-2 md:[&>li:last-child:nth-child(odd)]:col-span-2" data-testid="server-checks">
                    {Object.entries(result.server.checks).map(([k, v]) => (
                      <li key={k} className="flex items-center justify-between gap-4 bg-mist p-4" data-state={v ? "pass" : "fail"}>
                        <span>
                          <code className="font-mono text-[12px] text-ink-2">{k}</code>
                          <span className="block text-[15px]">{human(k)}</span>
                        </span>
                        <Mark state={v ? "pass" : "fail"} />
                      </li>
                    ))}
                    {result.server.signals && !("signals" in result.server.checks) ? (
                      <li className="flex items-center justify-between gap-4 bg-mist p-4" data-state={signalsState(result.server.signals)}>
                        <span>
                          <code className="font-mono text-[12px] text-ink-2">signals</code>
                          <span className="block text-[15px]">{human("signals")}</span>
                          <span className="block font-mono text-[12px] text-ink-2">
                            {result.server.signals.verified} verified · {result.server.signals.missing} missing · {result.server.signals.mismatch} from another miner ·{" "}
                            {result.server.signals.unchecked} not answered
                          </span>
                        </span>
                        <Mark state={signalsState(result.server.signals)} />
                      </li>
                    ) : null}
                  </ul>
                  {Object.entries(result.server)
                    .filter(([k, v]) => !["id", "ok", "checks", "verdictHash", "bomRoot", "receipts", "problems", "attester", "signals"].includes(k) && v !== null && v !== undefined)
                    .map(([k, v]) => (
                      <p key={k} className="mt-3 font-mono text-[12px] text-ink-2">
                        {k}: <span className="break-all">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                      </p>
                    ))}
                  {result.server.attester ? (
                    <p className="mt-4 font-mono text-[12px] text-ink-2">
                      The API signed with <span className="break-all">{result.server.attester}</span>
                      {result.attester && result.server.attester.toLowerCase() !== result.attester.toLowerCase() ? <strong className="text-reject-deep"> (not the published attester)</strong> : null}
                    </p>
                  ) : null}
                  {result.server.problems.length ? (
                    <ul className="mt-4 font-mono text-[13px] text-reject-deep">
                      {result.server.problems.map((p) => <li key={p}>{p}</li>)}
                    </ul>
                  ) : null}
                </>
              ) : (
                <p className="mt-3 font-mono text-[13px] text-reject-deep">The API&apos;s replay did not answer: {result.serverError}</p>
              )}
            </Section>
          ) : null}

          <Section tone="dark" inner="py-16 md:py-20">
            <div className="grid gap-px bg-line md:grid-cols-2">
              {(
                [
                  ["verdict hash", result.client.verdictHash.stored, result.client.verdictHash.recomputed],
                  ["bom root", result.client.bomRoot.stored, result.client.bomRoot.recomputed],
                ] as [string, string, string | null][]
              ).map(([label, a, b]) => (
                <div key={label} className="bg-surface p-6 md:p-8">
                  <div className="font-mono text-[12px] uppercase tracking-wider text-muted">{label}</div>
                  <dl className="mt-4 space-y-3 font-mono text-[13px]">
                    <div><dt className="text-muted">stored</dt><dd className="break-all">{a}</dd></div>
                    <div>
                      <dt className="text-muted">recomputed in this tab</dt>
                      <dd className="break-all" style={{ color: a === b ? "var(--color-thread)" : "var(--color-reject)" }}>{b ?? "not recomputed"}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
            {result.id ? (
              <p className="mt-6 font-mono text-[12px] text-muted">
                <Link href={`/v/${result.id}`} className="underline">open the verdict</Link> · {short(result.client.verdictHash.stored)}
              </p>
            ) : null}
          </Section>
        </>
      ) : !error ? (
        <Section tone="paper" inner="py-16 md:py-24">
          <Lead tag="What gets checked, and where" />
          <div className="mt-6 grid gap-12 lg:grid-cols-2">
            <div>
              <h3 className="font-mono text-[13px] uppercase tracking-wider text-ink-2">In your browser</h3>
              <ol className="mt-4 space-y-4">
                {[
                  ["Policy file", "The published YAML's SHA-256, computed here, against the one sealed into the verdict hash."],
                  ["Decision rerun", "The frozen engine that sealed the verdict decides again from its recorded findings."],
                  ["Verdict hash", "keccak256 over the canonical findings, decision, policy and engine: byte for byte."],
                  ["Receipts' Merkle root", "Rebuilt from every receipt in the bill of materials."],
                  ["Signature", "The EIP-191 signature over the message rebuilt from the verdict, recovered and compared with the published attester."],
                ].map(([t, l]) => (
                  <li key={t}>
                    <h4 className="statement text-[24px] md:text-[32px]">{t}</h4>
                    <p className="mt-1 text-ink-2">{l}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3 className="font-mono text-[13px] uppercase tracking-wider text-ink-2">By the API (POST /v1/verify)</h3>
              <ol className="mt-4 space-y-4">
                {[
                  ["Raw answers re-read", "Each paid answer re-read by the adapter version recorded with it. Raw answers are not public, so only the API can do this."],
                  ["Receipts against purchases", "The BOM's receipts are exactly the purchase log's, and findings without a purchase are only non-answers or a known list screen."],
                  ["Signals on the network", "Each paid answer's signal hash looked up on the Telegraph node, and the miner that answered compared with the one paid."],
                ].map(([t, l]) => (
                  <li key={t}>
                    <h4 className="statement text-[24px] md:text-[32px]">{t}</h4>
                    <p className="mt-1 text-ink-2">{l}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Section>
      ) : null}
    </>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyInner />
    </Suspense>
  );
}
