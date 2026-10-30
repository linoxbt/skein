import { CornerCard } from "@/components/ui";
import { API } from "@/lib/api";

const curl = (api: string) => `curl -X POST ${api}/v1/verdicts \\
  -H "Authorization: Bearer $SKEIN_PARTNER_KEY" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{"subject":{"chainId":8453,"token":"0x…"},"policy":"dex-list@0.1.0"}'`;

export default function DocsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-sans text-[28px] font-medium">Integrate</h1>
        <p className="text-muted">One integration instead of seven. Every verdict carries its policy, every input&apos;s receipt, and a hash anyone can recompute.</p>
      </div>
      <CornerCard className="space-y-3">
        <div className="font-sans text-[20px]">Direct API</div>
        <p className="text-muted">Partner keys are free during the hackathon. Ask in the Telegraph Discord.</p>
        <pre className="overflow-auto rounded-sm border border-line bg-bg p-3 text-[12px]">{curl(API)}</pre>
        <ul className="list-disc space-y-1 pl-5 text-[12px] text-muted">
          <li><code>mode: &quot;async&quot;</code> returns 202 with an id; stream <code>/v1/verdicts/&#123;id&#125;/events</code> (SSE).</li>
          <li>A replayed Idempotency-Key returns the original verdict and is not charged again.</li>
          <li>Every response carries <code>X-Skein-Verdict-Hash</code> and <code>X-Skein-Bom-Root</code>; <code>POST /v1/verify</code> recomputes both.</li>
          <li>Errors are <code>&#123; error: &#123; code, message, details &#125; &#125;</code>: BUDGET_TOO_LOW (422), UPSTREAM_UNAVAILABLE (503), RATE_LIMITED (429).</li>
        </ul>
      </CornerCard>
      <CornerCard className="space-y-2">
        <div className="font-sans text-[20px]">Through Telegraph</div>
        <p className="text-muted">Once Skein is registered (Nov 1), any Telegraph app reaches it with one paid <code>/engine/v1/ask</code>, routed to the Skein miner or pinned to its ID. That call counts as your own Telegraph purchase.</p>
      </CornerCard>
      <CornerCard className="space-y-2">
        <div className="font-sans text-[20px]">SDK and MCP</div>
        <p className="text-muted"><code>@skein/sdk</code> (TypeScript) and <code>@skein/mcp</code> (for LLM agents) are next on the build plan.</p>
      </CornerCard>
    </div>
  );
}
