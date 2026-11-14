"use client";
import Link from "next/link";
import { useState } from "react";
import { Lead, PageHero, Section } from "@skein/ui";
import { Stripes } from "@skein/ui";
import { toHex } from "viem";
import { API, claimKey, keyChallenge, SkeinError, type IssuedKey } from "@/lib/api";

/** The Console reads the key from here, so a new key works there at once (this tab only). */
const KEY_STORE = "skein.partnerKey";
const KEY_REQUEST = "https://github.com/linoxbt/skein/issues/new?template=partner-key.yml";

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}
const wallet = () => (typeof window === "undefined" ? undefined : (window as unknown as { ethereum?: Eip1193 }).ethereum);

type Phase = "idle" | "connecting" | "signing" | "issuing" | "done" | "error";

export default function KeysPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [name, setName] = useState("");
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const busy = phase === "connecting" || phase === "signing" || phase === "issuing";

  async function signIn() {
    setError(null);
    setIssued(null);
    setCopied(false);
    const eth = wallet();
    if (!eth) {
      setPhase("error");
      setError("No browser wallet found. Install one (MetaMask, Rabby, Coinbase Wallet…) and reload, or request a key from the team below.");
      return;
    }
    try {
      setPhase("connecting");
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const address = accounts[0];
      if (!address) throw new Error("the wallet shared no account");
      const ch = await keyChallenge(address);
      setPhase("signing");
      // personal_sign: the wallet shows the plain-text message; nothing is sent on chain.
      const signature = (await eth.request({ method: "personal_sign", params: [toHex(ch.message), address] })) as string;
      setPhase("issuing");
      const k = await claimKey(ch.nonce, signature, name.trim() || undefined);
      setIssued(k);
      setPhase("done");
      try {
        sessionStorage.setItem(KEY_STORE, k.key);
      } catch {
        // ignore
      }
    } catch (e) {
      setPhase("error");
      const code = (e as { code?: number }).code;
      setError(
        e instanceof SkeinError
          ? `${e.body.code}: ${e.body.message}`
          : code === 4001
            ? "You declined in the wallet; nothing was issued."
            : `The wallet said: ${(e as Error).message ?? String(e)}`,
      );
    }
  }

  async function copy() {
    if (!issued) return;
    await navigator.clipboard.writeText(issued.key).catch(() => {});
    setCopied(true);
  }

  const status = { idle: "", connecting: "Waiting for the wallet to connect…", signing: "Sign the message in your wallet. It is not a transaction and costs nothing.", issuing: "Checking the signature…", done: "", error: "" }[phase];

  return (
    <>
      <PageHero
        compact
        tag="API keys"
        title={<>Get an API key.</>}
        sub="Sign in with your wallet: one signature, no transaction, no gas. Your key works on the Console, the API, the SDK and the MCP server."
        background={<Stripes seed={52} className="opacity-25" />}
      />

      <Section tone="dark" inner="pb-20 pt-4">
        <div className="grid gap-10 lg:grid-cols-[1fr_1fr]">
          <div className="border border-edge bg-panel p-6 md:p-8">
            {issued ? (
              <div>
                <div className="font-mono text-[12px] uppercase tracking-wider text-thread">Your key{issued.replaced ? " (it replaces this wallet's previous key)" : ""}</div>
                <div className="mt-4 break-all border border-edge bg-bg p-4 font-mono text-[15px] text-text" data-testid="issued-key">{issued.key}</div>
                <p className="mt-3 font-mono text-[12px] text-knot">Shown once: Skein keeps only its SHA-256. Copy it now.</p>
                <div className="mt-6 flex flex-wrap">
                  <button type="button" onClick={copy} className="btn btn-primary">{copied ? "Copied" : "Copy the key"}</button>
                  <Link href="/console" className="btn btn-light">Use it in the Console</Link>
                </div>
                <dl className="mt-8 grid grid-cols-2 gap-4 font-mono text-[13px]">
                  <div><dt className="text-muted">name</dt><dd className="mt-1 text-text">{issued.name}</dd></div>
                  <div><dt className="text-muted">wallet</dt><dd className="mt-1 break-all text-text">{issued.wallet}</dd></div>
                  <div><dt className="text-muted">daily cap</dt><dd className="mt-1 text-text">${issued.dailyCapUsdc.toFixed(2)} of upstream checks</dd></div>
                  <div><dt className="text-muted">plan</dt><dd className="mt-1 text-text">self-serve</dd></div>
                </dl>
              </div>
            ) : (
              <div>
                <label className="block">
                  <span className="mb-2 block font-mono text-[12px] uppercase tracking-wider text-muted">name for the key (optional)</span>
                  <input className="field" placeholder="my listing bot" maxLength={48} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
                </label>
                <button type="button" onClick={signIn} disabled={busy} className="btn btn-primary mt-6 w-full">
                  {busy ? "Working…" : "Connect wallet and sign"}
                </button>
                <p className="mt-4 min-h-[20px] font-mono text-[12px] text-muted" aria-live="polite">{status}</p>
                {error ? <p className="mt-2 font-mono text-[13px] text-reject" role="alert">{error}</p> : null}
              </div>
            )}
          </div>

          <div className="space-y-6 text-[16px] leading-relaxed text-muted">
            <p>
              <span className="text-text">One key per wallet.</span> Signing in again with the same wallet replaces its key, so a lost key is
              never a problem: sign again.
            </p>
            <p>
              <span className="text-text">Free during the hackathon, with a cap.</span> A self-serve key may spend a small amount a day on the
              upstream checks behind its verdicts, and all self-serve keys share a daily budget. Cached verdicts, quotes, verdict pages and
              verification are free and need no key.
            </p>
            <p>
              <span className="text-text">Need more?</span> <a className="text-thread underline underline-offset-4" href={KEY_REQUEST}>Request a partner key</a>{" "}
              with a higher cap, or pay per verdict with no key at all, through Telegraph or x402 (<Link className="text-thread underline underline-offset-4" href="/tutorial#telegraph">how</Link>).
            </p>
          </div>
        </div>
      </Section>

      <Section tone="paper" inner="py-16 md:py-24">
        <Lead tag="Use it" />
        <pre className="overflow-x-auto border border-rule bg-mist p-5 font-mono text-[13px] leading-relaxed">{`curl -s ${API}/v1/verdicts \\
  -H "authorization: Bearer ${issued ? issued.key.slice(0, 12) + "…" : "sk_part_…"}" \\
  -H "content-type: application/json" \\
  -H "idempotency-key: $(uuidgen)" \\
  -d '{"subject":{"chainId":8453,"token":"0x4200000000000000000000000000000000000006"}}'`}</pre>
        <p className="mt-4 text-ink-2">
          Or with the SDK: <code className="font-mono">new Skein({"{"} payer: {"{"} kind: &quot;apiKey&quot;, key {"}"} {"}"})</code>. The{" "}
          <Link className="underline underline-offset-4" href="/tutorial">tutorial</Link> walks through it.
        </p>
      </Section>
    </>
  );
}
