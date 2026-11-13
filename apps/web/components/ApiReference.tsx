"use client";
import { useEffect, useState } from "react";
import { Lead, Section } from "@skein/ui";
import { API, getOpenApi, SkeinError } from "@/lib/api";
import { operations, type Json, type Operation } from "@/lib/openapi";

const anchor = (o: Operation) => `${o.method}-${o.path}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const auth = (o: Operation) => {
  const s = o.security as Json[] | undefined;
  if (!s?.length) return "public";
  const names = s.flatMap((x) => Object.keys(x));
  return names.length ? `${names.join(" or ")}${s.some((x) => !Object.keys(x).length) ? " (or none)" : ""}` : "public";
};

/**
 * The API reference, rendered from the API's own /v1/openapi.json: no third
 * party script, so the site's content security policy stays as it is.
 */
export function ApiReference() {
  const [doc, setDoc] = useState<Json | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getOpenApi()
      .then(setDoc)
      .catch((e) => setErr(e instanceof SkeinError ? `${e.body.code}: ${e.body.message}` : "the Skein API did not answer"));
  }, []);
  const ops = doc ? operations(doc) : [];
  const info = (doc?.info ?? {}) as { title?: string; version?: string; description?: string };

  return (
    <>
      <Section tone="dark" inner="pb-16">
        {err ? (
          <p role="alert" className="border border-reject/50 bg-reject/10 p-6 font-mono text-[14px] text-reject">
            {err}. The document is at <a className="underline" href={`${API}/v1/openapi.json`}>{API}/v1/openapi.json</a>.
          </p>
        ) : !doc ? (
          <p className="font-mono text-[13px] text-muted">Reading {API}/v1/openapi.json…</p>
        ) : (
          <>
            <p className="max-w-3xl text-muted">{info.description}</p>
            <p className="mt-4 font-mono text-[12px] text-muted">
              {info.title} {info.version} · OpenAPI {String(doc.openapi)} · base {API} · <a className="underline" href={`${API}/v1/openapi.json`}>raw JSON</a>
            </p>
            <nav aria-label="Operations" className="mt-8 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
              {ops.map((o) => (
                <a key={anchor(o)} href={`#${anchor(o)}`} className="flex gap-3 bg-surface p-3 font-mono text-[13px] hover:bg-surface-2">
                  <span className={o.method === "GET" ? "text-muted" : "text-thread"}>{o.method}</span>
                  <span className="min-w-0 break-all">{o.path}</span>
                </a>
              ))}
            </nav>
          </>
        )}
      </Section>
      {ops.length ? (
        <Section tone="paper" inner="py-16 md:py-24">
          <Lead tag="Operations" />
          <ol className="space-y-12">
            {ops.map((o) => (
              <li key={anchor(o)} id={anchor(o)} className="scroll-mt-28 border-t border-rule pt-8">
                <div className="flex flex-wrap items-baseline gap-4">
                  <span className={`font-mono text-[14px] ${o.method === "GET" ? "text-ink-2" : "text-thread-deep"}`}>{o.method}</span>
                  <code className="break-all font-mono text-[20px] md:text-[24px]">{o.path}</code>
                  <span className="font-mono text-[12px] uppercase tracking-wider text-ink-2">{auth(o)}</span>
                </div>
                {o.summary ? <h3 className="statement mt-3 text-[22px] md:text-[28px]">{o.summary}</h3> : null}
                {o.description ? <p className="mt-3 max-w-4xl whitespace-pre-line text-ink-2">{o.description}</p> : null}
                {o.parameters?.length ? (
                  <div className="mt-6 overflow-x-auto" tabIndex={0} role="region" aria-label={`${o.method} ${o.path} parameters`}>
                    <table className="w-full min-w-[560px] text-left font-mono text-[13px]">
                      <thead className="text-ink-2"><tr><th className="py-1 font-normal">parameter</th><th className="font-normal">in</th><th className="font-normal">type</th><th className="font-normal">notes</th></tr></thead>
                      <tbody>
                        {o.parameters.map((p) => (
                          <tr key={`${p.in}-${p.name}`} className="border-t border-rule align-top">
                            <td className="py-2">{p.name}{p.required ? <span className="text-reject-deep"> *</span> : null}</td>
                            <td>{p.in}</td>
                            <td>{String((p.schema as { type?: string } | undefined)?.type ?? "")}</td>
                            <td className="text-ink-2">{p.description ?? ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {o.requestBody?.content ? (
                  <details className="mt-6">
                    <summary className="cursor-pointer font-mono text-[13px] text-ink-2">request body</summary>
                    <pre tabIndex={0} className="mt-2 max-h-96 overflow-auto bg-mist p-4 font-mono text-[12px]">{JSON.stringify(Object.values(o.requestBody.content)[0]?.schema ?? {}, null, 2)}</pre>
                  </details>
                ) : null}
                {o.responses ? (
                  <ul className="mt-6 space-y-1 font-mono text-[13px]">
                    {Object.entries(o.responses).map(([code, r]) => (
                      <li key={code} className="flex gap-4">
                        <span className={code.startsWith("2") ? "text-thread-deep" : "text-reject-deep"}>{code}</span>
                        <span className="text-ink-2">{r.description ?? ""}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}
    </>
  );
}
