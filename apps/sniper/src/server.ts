import { Hono } from "hono";
import { changeSinceCheck, type SniperConfig } from "./agent";
import type { Stats, Store, TokenRecord } from "./store";

export interface Feed {
  generatedAt: string;
  config: Pick<SniperConfig, "policy" | "minLiquidityUsd" | "minAgeMin" | "maxAgeMin" | "dailyChecks" | "ticketUsd">;
  rail: string;
  attester: string | null;
  watching: number;
  last24h: Stats;
  allTime: Stats;
  /** The paper book: positions opened on APPROVE, and what the skipped tokens did. */
  book: { open: number; pnlUsd: number; skippedTracked: number; skippedDownHalf: number; medianSkippedChange: number | null };
  decisions: (TokenRecord & { change: number | null })[];
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export async function buildFeed(store: Store, cfg: SniperConfig, meta: { rail: string; attester: string | null }, now = new Date()): Promise<Feed> {
  const day = new Date(now.getTime() - 86_400_000);
  const [last24h, allTime, watching, decisions] = await Promise.all([
    store.stats(day),
    store.stats(new Date(0)),
    store.byStatus("watching", 10_000).then((r) => r.length),
    store.checkedSince(new Date(now.getTime() - 7 * 86_400_000), 100),
  ]);
  const withChange = decisions.map((r) => ({ ...r, change: changeSinceCheck(r) }));
  const bought = withChange.filter((r) => r.action === "buy" && r.status === "decided");
  const skipped = withChange.filter((r) => r.action === "skip" && r.status === "decided" && r.change !== null);
  return {
    generatedAt: now.toISOString(),
    config: { policy: cfg.policy, minLiquidityUsd: cfg.minLiquidityUsd, minAgeMin: cfg.minAgeMin, maxAgeMin: cfg.maxAgeMin, dailyChecks: cfg.dailyChecks, ticketUsd: cfg.ticketUsd },
    rail: meta.rail,
    attester: meta.attester,
    watching,
    last24h,
    allTime,
    book: {
      open: bought.length,
      pnlUsd: Math.round(bought.reduce((s, r) => s + cfg.ticketUsd * (r.change ?? 0), 0) * 100) / 100,
      skippedTracked: skipped.length,
      skippedDownHalf: skipped.filter((r) => (r.change ?? 0) <= -0.5).length,
      medianSkippedChange: median(skipped.map((r) => r.change!)),
    },
    decisions: withChange,
  };
}

export function createServer(store: Store, cfg: SniperConfig, meta: { rail: string; attester: string | null; skeinWeb: string }) {
  const app = new Hono();
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/feed.json", async (c) => {
    c.header("access-control-allow-origin", "*");
    c.header("cache-control", "no-store");
    return c.json(await buildFeed(store, cfg, meta));
  });
  // Every decided token since a time, for the evaluation's prospective set
  // (eval-tools prospective): the feed keeps only the latest 100.
  app.get("/checked.json", async (c) => {
    const since = Date.parse(c.req.query("since") ?? "");
    const from = Number.isFinite(since) ? new Date(since) : new Date(Date.now() - 30 * 86_400_000);
    const rows = await store.checkedSince(from, 5000);
    return c.json({ since: from.toISOString(), count: rows.length, tokens: rows.map((r) => ({ ...r, change: changeSinceCheck(r) })) });
  });
  app.get("/", (c) => c.html(dashboard(meta.skeinWeb)));
  return app;
}

/** The live page: one HTML document that polls /feed.json. No framework, no build step. */
export function dashboard(skeinWeb: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Skein Sniper · rug-proof launch gate on Base</title>
<meta name="description" content="An agent that watches every new token pool on Base and buys a Skein verdict before it would buy the token. Paper trades; verdicts bought live.">
<style>
:root{--bg:#000;--panel:#131518;--edge:#2a2f35;--text:#f2f4f5;--muted:#8b979f;--thread:#2ee6c8;--approve:#3ddc84;--reject:#ff5d5d;--escalate:#f2b84b;--abstain:#8a96a3}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1240px;margin:0 auto;padding:32px 16px 64px}a{color:var(--thread)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.muted{color:var(--muted)}
header .tag{display:inline-block;border:1px solid var(--edge);padding:3px 10px;font:12px ui-monospace,monospace;color:var(--muted)}
h1{font-size:clamp(34px,6vw,64px);line-height:1.02;margin:16px 0 10px;letter-spacing:-.02em}
.lead{max-width:760px;color:var(--muted);font-size:17px}
.grid{display:grid;gap:1px;background:var(--edge);border:1px solid var(--edge);margin-top:28px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.stat{background:var(--panel);padding:16px}.stat b{display:block;font-size:30px;font-weight:500;margin-top:4px}
.stat span{font:12px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
h2{font:12px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--thread);margin:36px 0 10px}
.scroll{overflow-x:auto;border:1px solid var(--edge)}table{width:100%;border-collapse:collapse;min-width:900px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--edge);vertical-align:top;font-size:14px}
th{font:11px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);background:var(--panel)}
.v{font:600 12px ui-monospace,monospace;padding:2px 8px;border:1px solid currentColor;display:inline-block}
.APPROVE{color:var(--approve)}.REJECT{color:var(--reject)}.ESCALATE{color:var(--escalate)}.ABSTAIN,.ERROR{color:var(--abstain)}
.buy{color:var(--approve);font-weight:600}.skip{color:var(--muted)}.up{color:var(--approve)}.down{color:var(--reject)}
.why{color:var(--muted);font-size:13px;max-width:360px}.note{border-left:3px solid var(--escalate);background:var(--panel);padding:12px 14px;margin-top:20px;color:var(--muted);font-size:14px}
footer{margin-top:40px;color:var(--muted);font-size:13px}
</style></head><body><div class="wrap">
<header><span class="tag">Telegraph Season II · Mission 14 · Web3 Native &amp; DeFi</span>
<h1>Rug-proof sniper.</h1>
<p class="lead">An agent watches every new token pool on Base (Uniswap v2, v3, v4 and Aerodrome). Before it would buy one, it buys a <a href="${skeinWeb}">Skein</a> verdict: contract audit, sanctions, liquidity, holders and wash trading, each bought from a ranked miner through Telegraph, fused under the <span id="policy" class="mono"></span> policy. <b>No APPROVE, no trade.</b></p>
<div class="note">Trades are <b>paper</b> (a $<span id="ticket"></span> position at the market price when the verdict lands); verdicts are bought live. Payments run on the Telegraph testnet; the tokens are real Base mainnet launches. Risk evidence, not investment advice.</div></header>
<div class="grid" id="stats"></div>
<h2>Spend panel: the cost of execution insurance</h2><div class="grid" id="spend"></div>
<h2>Decisions <span class="muted" id="gen"></span></h2>
<div class="scroll"><table><thead><tr><th>When</th><th>Token</th><th>Liquidity</th><th>Verdict</th><th>Action</th><th>Why</th><th>Since check</th><th>Cost</th><th>Proof</th></tr></thead><tbody id="rows"><tr><td colspan="9" class="muted">Loading…</td></tr></tbody></table></div>
<footer>Watching <span id="watching">0</span> launches for liquidity · checks a token once it has $<span id="minliq"></span> of liquidity, at least <span id="minage"></span> minutes after launch · at most <span id="daily"></span> paid verdicts a day · rail: <span id="rail" class="mono"></span> · signatures checked against <span id="attester" class="mono"></span>. Source: <a href="https://github.com/linoxbt/skein/tree/main/apps/sniper">github.com/linoxbt/skein/apps/sniper</a> · data: <a href="feed.json">feed.json</a></footer>
</div><script>
const $=(id)=>document.getElementById(id);const esc=(s)=>String(s??"").replace(/[&<>"]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const usd=(n)=>n==null?"—":"$"+Number(n).toLocaleString("en-US",{maximumFractionDigits:n<1?6:0});
const pct=(x)=>x==null?"—":(x>=0?"+":"")+(x*100).toFixed(1)+"%";const ago=(t)=>{const m=Math.round((Date.now()-Date.parse(t))/60000);return m<60?m+" min ago":m<1440?Math.round(m/60)+" h ago":Math.round(m/1440)+" d ago"};
const stat=(k,v,sub)=>'<div class="stat"><span>'+k+'</span><b>'+v+'</b>'+(sub?'<div class="muted mono" style="font-size:12px">'+sub+'</div>':'')+'</div>';
async function load(){try{const f=await (await fetch("feed.json",{cache:"no-store"})).json();
$("policy").textContent=f.config.policy;$("ticket").textContent=f.config.ticketUsd;$("watching").textContent=f.watching;$("minliq").textContent=f.config.minLiquidityUsd.toLocaleString("en-US");$("minage").textContent=f.config.minAgeMin;$("daily").textContent=f.config.dailyChecks;$("rail").textContent=f.rail;$("attester").textContent=f.attester||"(none pinned)";
const s=f.last24h,a=f.allTime;
$("stats").innerHTML=stat("Launches seen, 24 h",s.seen,a.seen+" all time")+stat("Verdicts bought, 24 h",s.checked,a.checked+" all time")+stat("Dodged",a.dodged,"REJECT, ESCALATE or ABSTAIN")+stat("Executed (paper)",a.bought,"APPROVE only")+stat("Never tradeable",a.expired,"no liquidity: no verdict bought");
$("spend").innerHTML=stat("Paid for verdicts",usd(a.paidUsdc),f.rail==="apiKey"?"partner key: free during the hackathon":"from the sniper's own escrow")+stat("At Skein list price",usd(a.listUsdc),a.checked?usd(a.listUsdc/a.checked)+" per verdict":"")+stat("Paper P&amp;L",(f.book.pnlUsd>=0?"+":"−")+usd(Math.abs(f.book.pnlUsd)),f.book.open+" open position(s)")+stat("Skipped tokens since",pct(f.book.medianSkippedChange),f.book.skippedDownHalf+" of "+f.book.skippedTracked+" down 50% or more");
$("gen").textContent="· updated "+new Date(f.generatedAt).toLocaleTimeString();
$("rows").innerHTML=f.decisions.length?f.decisions.map((r)=>{const v=r.status==="error"?"ERROR":r.verdict;const ch=r.change;
return '<tr><td class="mono">'+ago(r.checkedAt)+'<div class="muted">'+(r.ageAtCheckMin??"?")+' min after launch</div></td>'
+'<td><b>'+esc(r.symbol||"?")+'</b> <span class="muted">'+esc(r.name||"")+'</span><div class="mono muted" style="font-size:12px"><a href="https://basescan.org/token/'+r.token+'">'+r.token.slice(0,8)+'…'+r.token.slice(-4)+'</a> · '+esc(r.dex)+(r.marketUrl?' · <a href="'+esc(r.marketUrl)+'">chart</a>':'')+'</div></td>'
+'<td class="mono">'+usd(r.liquidityUsd)+'</td><td><span class="v '+v+'">'+v+'</span>'+(r.riskBps!=null?'<div class="muted mono">'+r.riskBps+' bps</div>':'')+'</td>'
+'<td class="'+(r.action==="buy"?"buy":"skip")+'">'+(r.action==="buy"?"BUY (paper)":"skip")+'</td>'
+'<td class="why">'+esc(r.status==="error"?r.note:(r.summary||""))+(r.reasons&&r.reasons.length?'<div>'+r.reasons.slice(0,3).map(esc).join("<br>")+'</div>':'')+'</td>'
+'<td class="mono '+(ch==null?"":ch>=0?"up":"down")+'">'+pct(ch)+'</td>'
+'<td class="mono">'+usd(r.paidUsdc)+'<div class="muted">list '+usd(r.priceUsdc)+'</div></td>'
+'<td class="mono">'+(r.verdictId?'<a href="${skeinWeb}/v/'+r.verdictId+'">verdict</a><br><a href="${skeinWeb}/verify?id='+r.verdictId+'">verify</a>'+(r.signatureOk?'<div class="up">signed ✓</div>':''):'—')+'</td></tr>'}).join(""):'<tr><td colspan="9" class="muted">No token has reached tradeable liquidity yet. Watching '+f.watching+' launches.</td></tr>';
}catch(e){$("gen").textContent="· feed unavailable, retrying"}}
load();setInterval(load,15000);
</script></body></html>`;
}
