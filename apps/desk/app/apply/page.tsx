"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lead, PageHero, Section } from "@/components/Section";
import { Stripes } from "@/components/Stripes";
import { CHAINS } from "@/lib/types";

const EXAMPLES: [string, string, number, string][] = [
  ["Wrapped Ether", "WETH · Base", 8453, "0x4200000000000000000000000000000000000006"],
  ["USD Coin", "USDC · Base", 8453, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
  ["Pepe", "PEPE · Ethereum", 1, "0x6982508145454Ce325dDbE47a25d4ec3d2311933"],
  ["Arbitrum", "ARB · Arbitrum", 42161, "0x912CE59144191C1204E64559FE8253a0e49E6548"],
];

export default function Apply() {
  const router = useRouter();
  const [form, setForm] = useState({ project: "", chainId: "8453", token: "", deployer: "", social: "", repo: "", contact: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== ""));
      const r = await fetch("/api/applications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
      router.push(`/a/${j.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHero
        compact
        tag="Apply"
        title={<>Apply to list.<br />Hear back in seconds.</>}
        sub="File a token the way a project would. The agent picks it up the moment it lands; nobody reads it unless Skein escalates."
        background={<Stripes seed={12} className="opacity-30" />}
      />

      <Section tone="dark" inner="pb-24">
        <div className="grid gap-px bg-edge lg:grid-cols-[1fr_380px]">
          <form onSubmit={submit} className="space-y-5 bg-panel p-6 md:p-10" aria-label="Listing application">
            <div className="grid gap-5 md:grid-cols-2">
              <label className="block md:col-span-2">
                <span className="mb-2 block font-mono text-[12px] uppercase tracking-wider text-muted">Project</span>
                <input className="field" required maxLength={80} placeholder="Project name" value={form.project} onChange={set("project")} />
              </label>
              <label className="block">
                <span className="mb-2 block font-mono text-[12px] uppercase tracking-wider text-muted">Chain</span>
                <select className="field" value={form.chainId} onChange={set("chainId")}>
                  {Object.entries(CHAINS).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block font-mono text-[12px] uppercase tracking-wider text-muted">Token contract</span>
                <input className="field" required pattern="^0x[0-9a-fA-F]{40}$" placeholder="0x…" value={form.token} onChange={set("token")} />
              </label>
              <label className="block">
                <span className="mb-2 block font-mono text-[12px] uppercase tracking-wider text-muted">Deployer (optional)</span>
                <input className="field" pattern="^0x[0-9a-fA-F]{40}$" placeholder="0x…" value={form.deployer} onChange={set("deployer")} />
              </label>
              <label className="block">
                <span className="mb-2 block font-mono text-[12px] uppercase tracking-wider text-muted">X handle (optional)</span>
                <input className="field" placeholder="@project" value={form.social} onChange={set("social")} />
              </label>
              <label className="block md:col-span-2">
                <span className="mb-2 block font-mono text-[12px] uppercase tracking-wider text-muted">Source repo (optional)</span>
                <input className="field" placeholder="https://github.com/org/repo" value={form.repo} onChange={set("repo")} />
              </label>
            </div>
            {error ? <p className="border border-reject/50 bg-reject/10 p-4 font-mono text-[13px] text-reject">{error}</p> : null}
            <button type="submit" disabled={busy} className="btn btn-primary w-full md:w-auto">{busy ? "The agent is deciding…" : "Submit application"}</button>
          </form>
          <aside className="bg-panel p-6 md:p-10">
            <h2 className="font-mono text-[12px] uppercase tracking-wider text-muted">Try a known token</h2>
            <ul className="mt-4 space-y-px">
              {EXAMPLES.map(([project, label, chain, token]) => (
                <li key={token}>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, project, chainId: String(chain), token })}
                    className="flex w-full items-center justify-between gap-4 bg-panel-2 px-4 py-4 text-left transition-colors hover:text-thread"
                  >
                    <span>{label}</span>
                    <span className="font-mono text-[12px] text-muted">{token.slice(0, 8)}…</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-[14px] text-muted">Each application buys one real verdict. The form takes a limited number a day.</p>
          </aside>
        </div>
      </Section>

      <Section tone="paper" inner="py-20 md:py-28">
        <Lead tag="Or by webhook" />
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <p className="statement text-[30px] md:text-[44px]">A listings form elsewhere can post straight into the queue.</p>
          <pre className="overflow-x-auto bg-ink p-6 font-mono text-[13px] leading-relaxed text-white">{`curl -X POST https://<desk>/api/applications \\
  -H "x-desk-webhook-secret: $DESK_WEBHOOK_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{ "project": "Acme", "chainId": 8453,
        "token": "0x…", "deployer": "0x…" }'
# → 201 { id, status, decision }`}</pre>
        </div>
      </Section>
    </>
  );
}
