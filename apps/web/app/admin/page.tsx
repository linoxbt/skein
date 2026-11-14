"use client";
import { useCallback, useEffect, useState } from "react";
import { Lead, PageHero, Section } from "@skein/ui";
import { adminCreateKey, adminKeys, adminRevoke, adminSetCap, SkeinError, type AdminKeys, type IssuedKey } from "@/lib/api";

/** The admin key stays in this tab only (sessionStorage), like the Console's partner key. */
const ADMIN_STORE = "skein.adminKey";
const shortAddr = (a: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
const usd = (n: number) => `$${n.toFixed(n > 0 && n < 0.1 ? 3 : 2)}`;
const errText = (e: unknown) => (e instanceof SkeinError ? `${e.body.code}: ${e.body.message}` : "the Skein API did not answer");

export default function AdminPage() {
  const [admin, setAdmin] = useState("");
  const [data, setData] = useState<AdminKeys | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: "", kind: "team", cap: "2" });
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [caps, setCaps] = useState<Record<string, string>>({});
  const [showRevoked, setShowRevoked] = useState(false);

  const load = useCallback(async (key: string) => {
    if (!key) return;
    setLoading(true);
    setError(null);
    try {
      setData(await adminKeys(key));
      try {
        sessionStorage.setItem(ADMIN_STORE, key);
      } catch {
        // ignore
      }
    } catch (e) {
      setData(null);
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      const k = sessionStorage.getItem(ADMIN_STORE);
      if (k) {
        setAdmin(k);
        void load(k);
      }
    } catch {
      // ignore
    }
  }, [load]);

  async function create(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setIssued(null);
    try {
      setIssued(await adminCreateKey(admin, { name: form.name.trim(), kind: form.kind, dailyCapUsdc: Number(form.cap) }));
      setForm({ ...form, name: "" });
      await load(admin);
    } catch (e) {
      setError(errText(e));
    }
  }

  async function saveCap(id: string) {
    setError(null);
    try {
      await adminSetCap(admin, id, Number(caps[id]));
      setCaps(({ [id]: _, ...rest }) => rest);
      await load(admin);
    } catch (e) {
      setError(errText(e));
    }
  }

  async function revoke(id: string, name: string) {
    if (!window.confirm(`Revoke "${name}"? This is final: the key stops working now and can never be restored.`)) return;
    setError(null);
    try {
      await adminRevoke(admin, id);
      await load(admin);
    } catch (e) {
      setError(errText(e));
    }
  }

  function signOut() {
    try {
      sessionStorage.removeItem(ADMIN_STORE);
    } catch {
      // ignore
    }
    setAdmin("");
    setData(null);
    setIssued(null);
  }

  const keys = (data?.keys ?? []).filter((k) => showRevoked || !k.revokedAt);
  const revokedCount = (data?.keys ?? []).filter((k) => k.revokedAt).length;
  const label = "mb-2 block font-mono text-[12px] uppercase tracking-wider text-muted";

  return (
    <>
      <PageHero compact tag="Admin" title={<>API keys.</>} sub="Create partner keys, change their caps and revoke them. Keys are shown once; Skein keeps only their SHA-256." />

      <Section tone="dark" inner="pb-16 pt-4">
        {!data ? (
          <form
            className="max-w-xl border border-edge bg-panel p-6"
            onSubmit={(e) => {
              e.preventDefault();
              void load(admin.trim());
            }}
          >
            <label className="block">
              <span className={label}>admin key</span>
              <input className="field" type="password" autoComplete="off" placeholder="sk_admin_…" value={admin} onChange={(e) => setAdmin(e.target.value)} />
            </label>
            <button type="submit" disabled={loading || !admin.trim()} className="btn btn-primary mt-6 w-full">{loading ? "Checking…" : "Open"}</button>
            <p className="mt-4 font-mono text-[12px] text-muted">The key stays in this tab only.</p>
            {error ? <p className="mt-3 font-mono text-[13px] text-reject" role="alert">{error}</p> : null}
          </form>
        ) : (
          <div className="space-y-10">
            <div className="flex flex-wrap items-baseline justify-between gap-4 font-mono text-[13px] text-muted">
              <span>
                Self-serve keys: {data.selfServe.enabled ? "on" : "off"} · {usd(data.selfServe.dailyCapUsdc)} a key a day · {usd(data.selfServe.spentTodayUsdc)} of{" "}
                {usd(data.selfServe.totalDailyUsdc)} shared budget spent today
              </span>
              <button type="button" onClick={signOut} className="btn btn-ghost">Close</button>
            </div>

            <form onSubmit={create} className="grid gap-4 border border-edge bg-panel p-6 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
              <label className="block">
                <span className={label}>new key: name</span>
                <input className="field" required maxLength={48} placeholder="Launchpad X" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="block">
                <span className={label}>kind</span>
                <select className="field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  <option value="team">team</option>
                  <option value="agent">agent</option>
                  <option value="contract">contract</option>
                </select>
              </label>
              <label className="block">
                <span className={label}>daily cap, USDC</span>
                <input className="field" inputMode="decimal" value={form.cap} onChange={(e) => setForm({ ...form, cap: e.target.value })} />
              </label>
              <button type="submit" className="btn btn-primary">Create key</button>
            </form>

            {issued ? (
              <div className="border border-thread p-6">
                <div className="font-mono text-[12px] uppercase tracking-wider text-thread">New key for {issued.name} (shown once)</div>
                <div className="mt-3 break-all bg-bg p-4 font-mono text-[15px] text-text">{issued.key}</div>
                <div className="mt-4 flex flex-wrap items-center gap-4">
                  <button type="button" className="btn btn-light" onClick={() => void navigator.clipboard.writeText(issued.key).catch(() => {})}>Copy</button>
                  <span className="font-mono text-[12px] text-knot">Send it to its owner privately. It cannot be shown again.</span>
                </div>
              </div>
            ) : null}

            {error ? <p className="font-mono text-[13px] text-reject" role="alert">{error}</p> : null}

            <div>
              <Lead tag={`${keys.length} key${keys.length === 1 ? "" : "s"}`} dark>
                {revokedCount ? (
                  <label className="ml-auto flex items-center gap-2 font-mono text-[12px] text-muted">
                    <input type="checkbox" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} /> show {revokedCount} revoked
                  </label>
                ) : null}
              </Lead>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] text-left text-[14px]">
                  <thead className="font-mono text-[12px] uppercase tracking-wider text-muted">
                    <tr className="border-b border-edge">
                      <th className="py-3 font-normal">name</th>
                      <th className="font-normal">plan</th>
                      <th className="font-normal">wallet</th>
                      <th className="font-normal">spent today</th>
                      <th className="font-normal">daily cap</th>
                      <th className="font-normal">created</th>
                      <th className="font-normal" />
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => {
                      const editable = !k.revokedAt && !k.seeded && k.plan !== "x402";
                      return (
                        <tr key={k.id} className={`border-b border-edge align-middle ${k.revokedAt ? "opacity-50" : ""}`}>
                          <td className="py-3 pr-4">
                            {k.name}
                            <div className="font-mono text-[11px] text-muted">{k.kind}{k.seeded ? " · seeded (SEED_CONSUMERS)" : ""}</div>
                          </td>
                          <td className="pr-4 font-mono text-[13px]">{k.plan === "self" ? "self-serve" : k.plan}</td>
                          <td className="pr-4 font-mono text-[13px]" title={k.wallet ?? undefined}>{shortAddr(k.wallet)}</td>
                          <td className="pr-4 font-mono text-[13px]">{usd(k.spentTodayUsdc)}</td>
                          <td className="pr-4 font-mono text-[13px]">
                            {editable ? (
                              <span className="flex items-center gap-2">
                                <input
                                  className="field h-9"
                                  style={{ width: 96 }}
                                  inputMode="decimal"
                                  aria-label={`daily cap for ${k.name}`}
                                  value={caps[k.id] ?? String(k.dailyCapUsdc)}
                                  onChange={(e) => setCaps({ ...caps, [k.id]: e.target.value })}
                                />
                                {caps[k.id] !== undefined && caps[k.id] !== String(k.dailyCapUsdc) ? (
                                  <button type="button" className="btn btn-light h-9 px-3" onClick={() => void saveCap(k.id)}>Save</button>
                                ) : null}
                              </span>
                            ) : (
                              usd(k.dailyCapUsdc)
                            )}
                          </td>
                          <td className="pr-4 font-mono text-[12px] text-muted">{k.createdAt.slice(0, 10)}</td>
                          <td className="text-right">
                            {k.revokedAt ? (
                              <span className="font-mono text-[12px] text-muted">revoked {k.revokedAt.slice(0, 10)}</span>
                            ) : k.plan === "x402" ? null : (
                              <button type="button" className="btn btn-ghost h-9 px-3 text-reject" onClick={() => void revoke(k.id, k.name)}>Revoke</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Section>
    </>
  );
}
