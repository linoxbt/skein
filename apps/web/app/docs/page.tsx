import type { Metadata } from "next";
import Link from "next/link";
import { IconArrow, IconPlug, IconReplay, IconTerminal, IconThreads } from "@/components/site/Icons";
import { Lead, PageHero, Section } from "@/components/site/Section";
import { Stripes } from "@/components/site/Stripes";
import { API } from "@/lib/api";

export const metadata: Metadata = { title: "Integrate" };

const WAYS: [string, string, string, typeof IconThreads][] = [
  ["Direct API", "One authenticated POST. Partner keys are free during the hackathon.", "live", IconTerminal],
  ["Through Telegraph", "One paid /engine/v1/ask, routed to the Skein miner or pinned to its ID.", "Nov 1", IconThreads],
  ["Verify anything", "POST any verdict id to /v1/verify and get each recomputed step back.", "live", IconReplay],
  ["SDK and MCP", "@skein/sdk for TypeScript agents; @skein/mcp gives Claude, Cursor or any MCP client three tools.", "live", IconPlug],
];

const ENDPOINTS: [string, string, string, string][] = [
  ["POST", "/v1/verdicts", "partner key", "Run a verdict. mode \"async\" returns 202 and an id."],
  ["GET", "/v1/verdicts/{id}", "public", "The verdict object, or { status: \"running\" }."],
  ["GET", "/v1/verdicts/{id}/events", "public", "Server-sent events: plan, purchase, finding, decision, done."],
  ["GET", "/v1/verdicts/{id}/bom", "public", "Bill of materials: every paid input and its receipt."],
  ["POST", "/v1/verify", "public", "Recompute a verdict from its raw answers."],
  ["GET", "/v1/quote", "public", "What a verdict would buy and cost for a token, without buying."],
  ["GET", "/v1/policies", "public", "Published policies. /v1/policies/{id@version} returns one."],
  ["GET", "/v1/status", "public", "Live intents, miners, spend and season state."],
  ["GET", "/v1/ledger", "public", "Verdicts served, upstream spend, recent ids."],
  ["POST", "/miner/verdict", "Telegraph", "The miner endpoint Telegraph routes paid asks to."],
];

const ERRORS: [string, number, string][] = [
  ["INVALID_SUBJECT", 400, "Unknown chain or a malformed token address."],
  ["UNKNOWN_POLICY", 400, "No published policy by that id and version."],
  ["IDEMPOTENCY_KEY_REQUIRED", 400, "POST /v1/verdicts needs an Idempotency-Key."],
  ["UNAUTHORIZED", 401, "Missing or revoked partner key."],
  ["IDEMPOTENCY_CONFLICT", 409, "The key was used with a different body."],
  ["BUDGET_TOO_LOW", 422, "Live floors exceed your budget; refused before any spend."],
  ["RATE_LIMITED", 429, "Slow down; Retry-After says how long."],
  ["UPSTREAM_UNAVAILABLE", 503, "A required intent has no live miner right now."],
  ["DAILY_CAP_REACHED", 503, "Skein's own spend cap for the day is used up."],
  ["TIMEOUT", 504, "Upstream answers did not arrive in time."],
];

const curl = (api: string) => `curl -X POST ${api}/v1/verdicts \\
  -H "Authorization: Bearer $SKEIN_PARTNER_KEY" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{
    "subject": { "chainId": 8453, "token": "0x…" },
    "policy": "dex-list@0.1.0",
    "mode": "async"
  }'`;

const sse = (api: string) => `const id = (await res.json()).id;
const events = new EventSource("${api}/v1/verdicts/" + id + "/events");
events.addEventListener("finding", (e) => draw(JSON.parse(e.data)));
events.addEventListener("done", (e) => seal(JSON.parse(e.data)));`;

const sdk = (api: string) => `import { Skein } from "@skein/sdk";

const skein = new Skein({
  apiUrl: "${api}",
  payer: { kind: "apiKey", key: process.env.SKEIN_KEY! },
  maxUsdcPerCall: 0.3, // refused before paying above this
});

const v = await skein.verdict({
  subject: { chainId: 8453, token: "0x…" },
});
if (v.verdict !== "APPROVE") return skip(v.reasons);
await skein.verify(v.id); // recompute it`;

const mcp = `{
  "mcpServers": {
    "skein": {
      "command": "npx",
      "args": ["tsx", "skein/packages/mcp/bin/skein-mcp.ts"],
      "env": { "SKEIN_API_KEY": "sk_part_…" }
    }
  }
}
// tools: skein_verdict · skein_quote · skein_verify`;

const ask = `POST /engine/v1/ask
{
  "intent": "FRAUD_RISK_TOKEN_LISTING",
  "params": { "chainId": 8453, "token": "0x…" }
}
→ 402 challenge → sign → X-PAYMENT → verdict + receipt`;

function Code({ label, children }: { label: string; children: string }) {
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
      <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed text-text">{children}</pre>
    </figure>
  );
}

export default function DocsPage() {
  return (
    <>
      <PageHero
        compact
        tag="Integrate"
        title={<>One integration<br />instead of seven.</>}
        sub="Every verdict carries its policy, every input's receipt, and a hash anyone can recompute. Pick the way in that suits you."
        background={<Stripes seed={3} className="opacity-35" />}
        actions={
          <>
            <a href="#quickstart" className="btn btn-primary">Quickstart</a>
            <a href="#endpoints" className="btn btn-light">Endpoints</a>
          </>
        }
      />

      {/* Four ways in. */}
      <Section tone="paper" inner="py-20 md:py-28">
        <Lead tag="Four ways in" />
        <div className="mt-4 grid gap-px bg-rule md:grid-cols-2">
          {WAYS.map(([title, line, when, Icon]) => (
            <article key={title} className="flex flex-col justify-between gap-10 bg-paper p-6 md:p-10">
              <div className="flex items-start justify-between gap-6">
                <span className="grid h-14 w-14 place-items-center bg-thread-deep text-white"><Icon size={28} /></span>
                <span className={`tag ${when === "live" ? "!bg-thread-deep !text-white" : ""}`}>{when}</span>
              </div>
              <div>
                <h2 className="display text-[40px] md:text-[56px]">{title}</h2>
                <p className="mt-3 max-w-md text-ink-2">{line}</p>
              </div>
            </article>
          ))}
        </div>
      </Section>

      {/* Quickstart. */}
      <Section tone="dark" id="quickstart" inner="py-20 md:py-28">
        <Lead tag="Quickstart" dark />
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <h2 className="display text-[44px] md:text-[72px]">Ask, watch, verify.</h2>
            <ol className="mt-10 space-y-6">
              {(
                [
                  ["01", "Ask", "POST the token and a policy. Async mode returns an id at once."],
                  ["02", "Watch", "Stream the events: each paid answer lands as its own thread."],
                  ["03", "Verify", "Every response carries X-Skein-Verdict-Hash and X-Skein-Bom-Root. POST /v1/verify recomputes both."],
                ] as [string, string, string][]
              ).map(([n, t, l]) => (
                <li key={n} className="grid grid-cols-[48px_1fr] gap-4">
                  <span className="grid h-10 w-10 place-items-center border border-edge font-mono text-[13px]">{n}</span>
                  <div>
                    <h3 className="text-[20px]">{t}</h3>
                    <p className="mt-1 text-muted">{l}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-10 font-mono text-[12px] text-muted">A replayed Idempotency-Key returns the original verdict and is not charged again.</p>
          </div>
          <div className="min-w-0 space-y-6">
            <Code label="shell · run a verdict">{curl(API)}</Code>
            <Code label="browser · stream it">{sse(API)}</Code>
          </div>
        </div>
      </Section>

      {/* Telegraph. */}
      <section className="relative overflow-hidden bg-bg">
        <Stripes seed={19} className="opacity-30" />
        <div className="relative mx-auto grid max-w-[1400px] gap-12 px-5 py-24 md:px-10 md:py-32 lg:grid-cols-2 lg:items-center">
          <div>
            <span className="tag tag-dark">Through Telegraph · from Nov 1</span>
            <h2 className="display mt-6 text-[44px] md:text-[72px]">No account. Pay per verdict.</h2>
            <p className="mt-6 max-w-xl text-[18px] text-muted">
              Any Telegraph app reaches Skein with one paid ask. The call settles from your own escrow and counts as your own Telegraph purchase; Skein&apos;s upstream receipts ride along in the bill of materials.
            </p>
          </div>
          <Code label="telegraph · /engine/v1/ask">{ask}</Code>
        </div>
      </section>

      {/* SDK and MCP. */}
      <Section tone="dark" inner="py-20 md:py-28">
        <Lead tag="SDK and MCP" dark />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="min-w-0">
            <h2 className="display text-[36px] md:text-[56px]">One function.</h2>
            <p className="mt-4 max-w-lg text-muted">
              verdict(), quote(), verify() and stream(), typed errors, retries that reuse the idempotency key, and a spend cap checked before any payment. Pays with a partner key or through Telegraph.
            </p>
            <div className="mt-8">
              <Code label="typescript · @skein/sdk">{sdk(API)}</Code>
            </div>
          </div>
          <div className="min-w-0">
            <h2 className="display text-[36px] md:text-[56px]">One server entry.</h2>
            <p className="mt-4 max-w-lg text-muted">
              The MCP server pays inside, with a per-call and a per-session cap, and returns the verdict as text an agent can act on plus the full object.
            </p>
            <div className="mt-8">
              <Code label="mcp client config · @skein/mcp">{mcp}</Code>
            </div>
          </div>
        </div>
      </Section>

      {/* Endpoints. */}
      <Section tone="paper" id="endpoints" inner="py-20 md:py-28">
        <Lead tag="Endpoints" />
        <p className="font-mono text-[13px] text-ink-2">base {API}</p>
        <ul className="mt-8">
          {ENDPOINTS.map(([m, path, auth, line], i) => (
            <li key={m + path}>
              <div className="grid grid-cols-[64px_1fr] gap-x-4 gap-y-1 py-5 md:grid-cols-[80px_minmax(0,1.1fr)_140px_minmax(0,1.4fr)] md:items-center md:gap-8">
                <span className={`font-mono text-[13px] ${m === "POST" ? "text-thread-deep" : "text-ink-2"}`}>{m}</span>
                <code className="min-w-0 break-all font-mono text-[15px] md:text-[17px]">{path}</code>
                <span className="col-start-2 font-mono text-[12px] uppercase tracking-wider text-ink-2 md:col-start-auto">{auth}</span>
                <span className="col-start-2 text-ink-2 md:col-start-auto">{line}</span>
              </div>
              {i < ENDPOINTS.length - 1 ? <div className="rule-dots" /> : null}
            </li>
          ))}
        </ul>
      </Section>

      {/* Errors. */}
      <Section tone="mist" inner="py-20 md:py-28">
        <Lead tag="Errors" />
        <h2 className="statement max-w-4xl text-[32px] md:text-[48px]">
          One error shape. Refusals happen before money moves.
        </h2>
        <code className="mt-6 block break-all font-mono text-[14px] text-ink-2">{"{ error: { code, message, details } }"}</code>
        <div className="mt-10 grid gap-px bg-rule sm:grid-cols-2">
          {ERRORS.map(([code, status, line]) => (
            <div key={code} className="bg-mist p-6">
              <div className="flex items-baseline justify-between gap-4">
                <code className="min-w-0 break-all font-mono text-[14px]">{code}</code>
                <span className={`font-mono text-[13px] ${status >= 500 ? "text-reject" : "text-ink-2"}`}>{status}</span>
              </div>
              <p className="mt-3 text-[15px] text-ink-2">{line}</p>
            </div>
          ))}
        </div>
      </Section>

      <section className="bg-bg">
        <div className="mx-auto grid max-w-[1400px] gap-px px-5 py-20 md:grid-cols-2 md:px-10 md:py-28">
          {(
            [
              ["Try it in the console", "/console"],
              ["Read the policies", "/policies"],
            ] as [string, string][]
          ).map(([t, href]) => (
            <Link key={href} href={href} className="group flex items-center justify-between gap-6 border border-edge bg-panel p-6 transition-colors hover:border-thread md:p-10">
              <span className="display text-[32px] md:text-[48px]">{t}</span>
              <span className="grid h-12 w-12 shrink-0 place-items-center bg-thread text-[#001510] transition-transform group-hover:translate-x-1"><IconArrow /></span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
