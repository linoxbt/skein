import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, F } from "../theme";
import { said, scene } from "../timeline";
import { Browser, clamp, Count, ease, Grain, Mark, Scroll, Tag, useSpring, Warp, Words } from "../ui";

const LAUNCHES = [
  ["FDOF", "Federal Dividend Oil Fund", "$136,156", "ABSTAIN"],
  ["USRP", "U.S Power Reserve", "$141,823", "ESCALATE"],
  ["USRN", "United States Reserve Nuclear", "$124,750", "ESCALATE"],
  ["VIOR", "Vanguard Iron", "$98,204", "REJECT"],
  ["GOLDX", "Gold Standard X", "$61,930", "REJECT"],
  ["AIDOG", "AI Doge Agent", "$44,120", "ESCALATE"],
  ["BSTR", "Base Strategic Reserve", "$212,400", "REJECT"],
  ["MNRL", "Mineral Rights Token", "$73,880", "ABSTAIN"],
];
const VC: Record<string, string> = { REJECT: C.reject, ESCALATE: C.escalate, ABSTAIN: C.abstain, APPROVE: C.approve };

/** 8. Mission 14: the sniper buys a verdict before every trade; its record, and how it is labelled. */
export const Sniper: React.FC = () => {
  const frame = useCurrentFrame();
  const s = scene("sniper");
  const tOf = said("sniper", "It has checked");
  const tFell = said("sniper", "every launch is labelled");
  const stats = interpolate(frame, [tOf - 6, tOf + 10], [0, 1], clamp);
  const fell = interpolate(frame, [tFell - 4, tFell + 12], [0, 1], { ...clamp, easing: ease });
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <div style={{ position: "absolute", inset: 0, opacity: 0.22 }}>
        <Scroll src="shots/sniper-full.jpg" imgH={9000} width={1920} start={0} end={3800} dur={s.dur} />
      </div>
      <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.75) 55%, rgba(0,0,0,0.4) 100%)" }} />
      <div style={{ position: "absolute", left: 110, top: 90 }}>
        <Tag delay={4}>Mission 14 · Skein Sniper</Tag>
        <div style={{ height: 22 }} />
        <Words text="Rug-proof sniper." delay={10} size={124} />
        <div style={{ fontFamily: F.display, fontSize: 34, color: C.muted, marginTop: 18, maxWidth: 900, opacity: useSpring(26) }}>Every new pool on Base. A Skein verdict before any trade. No APPROVE, no trade.</div>
      </div>
      <div style={{ position: "absolute", right: 90, top: 90, width: 760, opacity: 1 - fell * 0.85 }}>
        {LAUNCHES.map((l, i) => {
          const t = 30 + i * 22;
          const p = useSpring(t, { damping: 15 });
          return (
            <div key={l[0]} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", marginBottom: 10, background: "rgba(19,21,24,0.9)", border: `1px solid ${C.edge}`, opacity: p, transform: `translateX(${(1 - p) * 80}px)` }}>
              <div style={{ fontFamily: F.mono, fontSize: 22, color: C.text }}>{l[0]} <span style={{ color: C.muted, fontSize: 17 }}>{l[1]}</span></div>
              <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                <span style={{ fontFamily: F.mono, fontSize: 18, color: C.muted }}>{l[2]}</span>
                <span style={{ fontFamily: F.mono, fontSize: 18, color: VC[l[3]], border: `1px solid ${VC[l[3]]}`, padding: "2px 10px" }}>{l[3]}</span>
                <span style={{ fontFamily: F.mono, fontSize: 18, color: C.knot }}>skip</span>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 110, bottom: 110, display: "flex", gap: 70, opacity: stats, transform: `translateY(${(1 - stats) * 40}px)` }}>
        {[
          ["Launches checked", 280, C.text],
          ["Bought", 0, C.thread],
        ].map(([label, n, col]) => (
          <div key={label as string}>
            <div style={{ fontFamily: F.mono, fontSize: 22, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
            <div style={{ fontFamily: F.display, fontSize: 130, fontWeight: 300, letterSpacing: "-0.05em", color: col as string }}><Count to={n as number} delay={tOf} dur={34} /></div>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", right: 110, bottom: 90, opacity: fell, transform: `scale(${0.9 + fell * 0.1})`, textAlign: "right" }}>
        <div style={{ fontFamily: F.mono, fontSize: 22, color: C.muted, letterSpacing: "0.08em" }}>EVERY LAUNCH LABELLED</div>
        <div style={{ fontFamily: F.display, fontSize: 210, fontWeight: 300, letterSpacing: "-0.06em", color: C.text, lineHeight: 1 }}>
          <Count to={72} delay={tFell} dur={40} /> h
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 22, color: C.muted, letterSpacing: "0.08em", marginTop: 10 }}>LATER · PUBLISHED DAILY</div>
      </div>
      <Grain />
    </AbsoluteFill>
  );
};

/** 9. Skein sells too: one paid ask to miner 845301, no account, no key. */
export const Miner: React.FC = () => {
  const frame = useCurrentFrame();
  const tNo = said("miner", "No account");
  const tKey = said("miner", "No key");
  const tReq = said("miner", "single paid request");
  const agents = ["Trading agent", "Exchange bot", "Wallet guard", "Launchpad"];
  const typed = "POST /engine/v1/ask/845301";
  const n = Math.floor(interpolate(frame, [tReq - 10, tReq + 26], [0, typed.length], clamp));
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Warp intensity={0.25} speed={0.6} seed="m" />
      <div style={{ position: "absolute", left: 110, top: 90 }}>
        <Tag delay={4}>Telegraph miner 5137 · listing 845301</Tag>
        <div style={{ height: 22 }} />
        <Words text="Skein sells back to the network." delay={10} size={100} accent={["network."]} />
      </div>
      <svg width="1920" height="1080" style={{ position: "absolute" }}>
        {agents.map((a, i) => {
          const y = 470 + i * 130;
          const p = interpolate(frame, [40 + i * 8, 70 + i * 8], [0, 1], { ...clamp, easing: ease });
          const k = ((frame - 70 - i * 9) % 45) / 45;
          return (
            <g key={a}>
              <path d={`M520,${y} C800,${y} 900,690 1180,690`} fill="none" stroke={C.thread} strokeWidth="2.5" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - p} opacity="0.7" />
              {frame > 70 && <circle cx={520 + (1180 - 520) * k} cy={y + (690 - y) * (k * k * (3 - 2 * k))} r="8" fill={C.knot} style={{ filter: "drop-shadow(0 0 8px rgba(242,184,75,0.9))" }} />}
            </g>
          );
        })}
      </svg>
      {agents.map((a, i) => {
        const p = useSpring(36 + i * 8);
        return <div key={a} style={{ position: "absolute", left: 160, top: 440 + i * 130, width: 360, opacity: p, transform: `translateX(${(1 - p) * -40}px)`, fontFamily: F.mono, fontSize: 24, color: C.text, background: C.panel, border: `1px solid ${C.edge}`, padding: "16px 20px" }}>{a}</div>;
      })}
      <div style={{ position: "absolute", left: 1180, top: 560, width: 600, background: C.panel, border: `1px solid ${C.thread}`, padding: 30, boxShadow: "0 0 60px rgba(46,230,200,0.25)", opacity: useSpring(50) }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Mark size={70} delay={50} drawFrames={18} glow={false} />
          <div style={{ fontFamily: F.display, fontSize: 52, letterSpacing: "-0.04em", color: C.text }}>skein-listing-verdict</div>
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 24, color: C.thread, marginTop: 22, minHeight: 34 }}>{typed.slice(0, n)}<span style={{ opacity: frame % 20 < 10 ? 1 : 0 }}>▍</span></div>
        <div style={{ fontFamily: F.mono, fontSize: 20, color: C.muted, marginTop: 10 }}>FRAUD_RISK_GENERAL · 0.25 USDC an answer</div>
      </div>
      <div style={{ position: "absolute", left: 1180, top: 870, display: "flex", gap: 24 }}>
        {[
          ["No account.", tNo],
          ["No key.", tKey],
        ].map(([w, t]) => {
          const p = useSpring((t as number) - 3, { damping: 10, stiffness: 190 });
          return <div key={w as string} style={{ opacity: p, transform: `scale(${1.6 - p * 0.6}) rotate(-3deg)`, border: `3px solid ${C.knot}`, color: C.knot, fontFamily: F.mono, fontSize: 40, padding: "8px 22px", letterSpacing: "0.06em" }}>{w}</div>;
        })}
      </div>
      <Grain />
    </AbsoluteFill>
  );
};

/** 10. The benchmark: no scam approved, no established token rejected. */
export const Bench: React.FC = () => {
  const frame = useCurrentFrame();
  const tNone = said("bench", "approved none");
  const tRej = said("bench", "rejected none");
  const dots = (n: number, color: string, start: number, mark: string) =>
    Array.from({ length: n }, (_, i) => {
      const p = interpolate(frame, [start + i * 3, start + i * 3 + 10], [0, 1], { ...clamp, easing: ease });
      return (
        <div key={i} style={{ width: 70, height: 70, border: `2px solid ${color}`, display: "flex", alignItems: "center", justifyContent: "center", opacity: p, transform: `scale(${0.5 + 0.5 * p})`, fontFamily: F.mono, fontSize: 30, color }}>{mark}</div>
      );
    });
  return (
    <AbsoluteFill style={{ background: C.mist }}>
      <div style={{ position: "absolute", left: 110, top: 90 }}>
        <Tag light delay={4} color={C.threadDeep}>Held-out benchmark · rules frozen · run once</Tag>
      </div>
      <div style={{ position: "absolute", left: 110, top: 220, width: 800 }}>
        <div style={{ fontFamily: F.display, fontSize: 250, fontWeight: 300, letterSpacing: "-0.06em", color: C.ink, lineHeight: 1 }}>0<span style={{ color: C.ink2, fontSize: 120 }}> / 7</span></div>
        <div style={{ fontFamily: F.display, fontSize: 48, letterSpacing: "-0.03em", color: C.ink, marginTop: 10 }}>documented scams approved</div>
        <div style={{ display: "flex", gap: 14, marginTop: 40, flexWrap: "wrap" }}>{dots(7, C.reject, tNone, "✕")}</div>
      </div>
      <div style={{ position: "absolute", left: 1000, top: 220, width: 820 }}>
        <div style={{ fontFamily: F.display, fontSize: 250, fontWeight: 300, letterSpacing: "-0.06em", color: C.ink, lineHeight: 1, opacity: interpolate(frame, [tRej - 10, tRej + 4], [0.15, 1], clamp) }}>0<span style={{ color: C.ink2, fontSize: 120 }}> / 13</span></div>
        <div style={{ fontFamily: F.display, fontSize: 48, letterSpacing: "-0.03em", color: C.ink, marginTop: 10, opacity: interpolate(frame, [tRej - 10, tRej + 4], [0.15, 1], clamp) }}>established tokens rejected</div>
        <div style={{ display: "flex", gap: 14, marginTop: 40, flexWrap: "wrap", width: 640 }}>{dots(13, "#0e6e3a", tRej, "✓")}</div>
      </div>
      <div style={{ position: "absolute", left: 110, bottom: 70, fontFamily: F.mono, fontSize: 22, color: C.ink2 }}>eval/FINDINGS-holdout.md · 20 tokens · two simpler rules on the same paid findings each let a scam through</div>
    </AbsoluteFill>
  );
};

const INTEGRATIONS = [
  { name: "REST API", cue: "A REST API", code: ["curl -X POST api.skeinlabs.site/v1/verdicts \\", "  -H 'authorization: Bearer $KEY' \\", "  -d '{\"subject\":{\"chainId\":8453,…}}'"] },
  { name: "TypeScript SDK", cue: "TypeScript", code: ["npm i @skeinlabs/sdk", "", "const v = await skein.verdict({ subject })", "v.verdict  // APPROVE"] },
  { name: "MCP server", cue: "M C P server", code: ["claude mcp add skein \\", "  -- npx -y @skeinlabs/mcp", "", "› is this token fit to list?"] },
  { name: "x402", cue: "x four oh two", code: ["POST /v1/verdicts", "← 402 Payment Required", "→ X-PAYMENT: <USDC authorization>", "← 200 verdict + receipt"] },
  { name: "Telegraph", cue: "Or Telegraph", code: ["POST /engine/v1/ask/845301", "intent: FRAUD_RISK_GENERAL", "← verdict, paid through escrow"] },
];

/** 11. Five ways in. */
export const Integrate: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <div style={{ position: "absolute", left: 110, top: 80 }}>
        <Tag delay={4}>Integrate</Tag>
        <div style={{ height: 20 }} />
        <Words text="Integrate it your way." delay={8} size={110} />
      </div>
      <div style={{ position: "absolute", left: 110, right: 110, top: 340, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 26 }}>
        {INTEGRATIONS.map((it, i) => {
          const t = said("integrate", it.cue, -0.25);
          const p = useSpring(t, { damping: 15 });
          const lit = interpolate(frame, [t, t + 6, t + 40], [0, 1, 0.35], clamp);
          return (
            <div key={it.name} style={{ width: 540, opacity: p, transform: `translateY(${(1 - p) * 50}px)`, background: C.panel, border: `1px solid ${lit > 0.4 ? C.thread : C.edge}`, padding: 26, minHeight: 250, boxShadow: `0 0 ${lit * 50}px rgba(46,230,200,0.3)` }}>
              <div style={{ fontFamily: F.display, fontSize: 46, letterSpacing: "-0.04em", color: C.text }}>{it.name}</div>
              <div style={{ marginTop: 16, fontFamily: F.mono, fontSize: 19, lineHeight: 1.65, color: C.muted, whiteSpace: "pre" }}>
                {it.code.map((l, k) => <div key={k} style={{ color: l.startsWith("←") || l.startsWith("v.") ? C.thread : l.startsWith("→") || l.startsWith("›") ? C.knot : undefined }}>{l || " "}</div>)}
              </div>
            </div>
          );
        })}
      </div>
      <Grain />
    </AbsoluteFill>
  );
};

/** 12. Close. */
export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const s = scene("outro");
  const tag = useSpring(s.voFrom + 18);
  const url = useSpring(said("outro", "Try it today"), { damping: 14 });
  const fade = interpolate(frame, [s.dur - 40, s.dur], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: fade }}>
      <Warp intensity={0.8} speed={0.8} seed="o" />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <Mark size={190} delay={6} drawFrames={28} />
          <div style={{ fontFamily: F.brand, fontWeight: 500, fontSize: 170, letterSpacing: "-0.06em", color: C.text }}>skein</div>
        </div>
        <div style={{ marginTop: 34, fontFamily: F.display, fontSize: 64, letterSpacing: "-0.04em", color: C.text, opacity: tag, transform: `translateY(${(1 - tag) * 20}px)` }}>
          Every decision, with <span style={{ color: C.knot }}>every receipt.</span>
        </div>
        <div style={{ marginTop: 60, opacity: url, transform: `scale(${0.9 + url * 0.1})`, fontFamily: F.mono, fontSize: 54, color: C.thread, border: `1px solid ${C.thread}`, padding: "14px 40px", boxShadow: "0 0 40px rgba(46,230,200,0.25)", background: "rgba(0,0,0,0.6)" }}>skeinlabs.site</div>
        <div style={{ marginTop: 40, display: "flex", gap: 40, fontFamily: F.mono, fontSize: 24, color: C.muted, opacity: url }}>
          <span>github.com/linoxbt/skein</span><span>npm i @skeinlabs/sdk</span><span>Telegraph miner 845301</span>
        </div>
      </AbsoluteFill>
      <Grain />
    </AbsoluteFill>
  );
};

export { Browser };
