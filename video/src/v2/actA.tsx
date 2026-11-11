import React from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame } from "remotion";
import { C, F, THREAD_PATH } from "../theme";
import { clamp, ease, easeInOut, Grain, Stripes, useSpring, Warp, Words } from "../ui";
import data from "./data.json";
import { BigMark, CodeCard, Dust, Flash, Glitch, Glow, Mono, Shake, Stamp } from "./kit";
import { at, scene } from "./tl";

/** Real Base launches the Sniper checked, and whether each went to zero afterwards (price change <= -90%). */
export const LAUNCHES = data.launches as { s: string; rug: boolean }[];

/* 1 — Cold open: a wall of real launches; most of them turn out to be traps. */
export const Cold: React.FC = () => {
  const frame = useCurrentFrame();
  const s = scene("cold");
  const tLive = at("cold", "thousands");
  const tHonest = at("cold", "honest");
  const tTraps = at("cold", "traps");
  const tHoney = at("cold", "honeypots");
  const tLiq = at("cold", "liquidity");
  const tSanc = at("cold", "wallets");
  const cols = 12, rows = 7;
  const fadeGrid = interpolate(frame, [tHoney - 6, tHoney + 4], [1, 0.12], clamp);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* the opening thread: a single heartbeat line */}
      <svg width="1920" height="1080" style={{ position: "absolute", opacity: interpolate(frame, [0, 10, tLive, tLive + 10], [0, 1, 1, 0], clamp) }}>
        <path d="M0 540 L760 540 L800 470 L840 610 L880 540 L1920 540" fill="none" stroke={C.thread} strokeWidth={3} pathLength={1} strokeDasharray="1" strokeDashoffset={1 - interpolate(frame, [0, tLive], [0, 1], { ...clamp, easing: easeInOut })} style={{ filter: `drop-shadow(0 0 12px ${C.thread})` }} />
      </svg>
      {/* the wall of launches */}
      <AbsoluteFill style={{ opacity: fadeGrid, padding: 70, display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 14, alignContent: "center" }}>
        {Array.from({ length: cols * rows }, (_, i) => {
          const L = LAUNCHES[i % LAUNCHES.length]!;
          const sym = L.s;
          const appear = tLive + (random(`a${i}`) * 40);
          const o = interpolate(frame, [appear, appear + 6], [0, 1], clamp);
          const honest = !L.rug;
          const lit = frame >= tHonest && honest;
          const trap = frame >= tTraps + random(`t${i}`) * 10 && !honest;
          const col = trap ? C.reject : lit ? C.approve : C.edge;
          return (
            <div key={i} style={{ opacity: o, height: 92, border: `1px solid ${col}`, background: trap ? "rgba(255,93,93,0.08)" : lit ? "rgba(61,220,132,0.08)" : "rgba(19,21,24,0.7)", padding: "10px 12px", display: "flex", flexDirection: "column", justifyContent: "space-between", boxShadow: trap ? "0 0 18px rgba(255,93,93,0.25)" : lit ? "0 0 18px rgba(61,220,132,0.25)" : undefined }}>
              <div style={{ fontFamily: F.mono, fontSize: 13, color: C.muted }}>BASE · NEW</div>
              <div style={{ fontFamily: F.display, fontSize: 26, fontWeight: 500, color: trap ? C.reject : C.text, letterSpacing: "-0.02em" }}>{sym}</div>
            </div>
          );
        })}
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 70, bottom: 26, opacity: fadeGrid * interpolate(frame, [tTraps, tTraps + 10], [0, 1], clamp) }}>
        <Mono size={17}>Real Base launches checked by Skein Sniper · <span style={{ color: C.reject }}>red: went to zero afterwards</span></Mono>
      </div>
      {/* the three traps */}
      <Shake hits={[tHoney, tLiq, tSanc]} amp={10}>
        {[
          { t: tHoney, end: tLiq, word: "HONEYPOT", sub: "buy: allowed · sell: blocked", icon: "lock" },
          { t: tLiq, end: tSanc, word: "LIQUIDITY PULLED", sub: "pool depth → $0, the day after launch", icon: "chart" },
          { t: tSanc, end: s.dur, word: "SANCTIONED WALLET", sub: "OFAC SDN · deployer match", icon: "flag" },
        ].map((x) => {
          const vis = frame >= x.t && frame < x.end;
          if (!vis) return null;
          const p = interpolate(frame - x.t, [0, 8], [0, 1], { ...clamp, easing: ease });
          return (
            <AbsoluteFill key={x.word} style={{ alignItems: "center", justifyContent: "center" }}>
              <div style={{ textAlign: "center", transform: `scale(${1.25 - 0.25 * p})`, opacity: p }}>
                {x.icon === "chart" && (
                  <svg width="560" height="170" style={{ marginBottom: 20 }}>
                    <polyline points={Array.from({ length: 40 }, (_, k) => `${k * 14},${k < 26 ? 40 + Math.sin(k) * 10 + random(`c${k}`) * 16 : 40 + (k - 25) * 9}`).join(" ")} fill="none" stroke={C.reject} strokeWidth={4} pathLength={1} strokeDasharray="1" strokeDashoffset={1 - interpolate(frame - x.t, [0, 26], [0, 1], clamp)} />
                  </svg>
                )}
                <Glitch delay={x.t} len={9}>
                  <div style={{ fontFamily: F.display, fontWeight: 500, fontSize: 150, letterSpacing: "-0.05em", color: C.reject, lineHeight: 1 }}>{x.word}</div>
                </Glitch>
                <Mono size={28} color={C.text} style={{ marginTop: 24 }}>{x.sub}</Mono>
              </div>
            </AbsoluteFill>
          );
        })}
      </Shake>
      <Flash at={tHoney} color={C.reject} peak={0.35} />
      <Flash at={tLiq} color={C.reject} peak={0.3} />
      <Flash at={tSanc} color={C.reject} peak={0.35} />
      <Grain />
    </AbsoluteFill>
  );
};

/* 2 — Reveal: warp, the mark draws itself, the wordmark and the promise. */
export const Reveal: React.FC = () => {
  const frame = useCurrentFrame();
  const s = scene("reveal");
  const knot = 50;
  const tOne = at("reveal", "one");
  const tListing = at("reveal", "listing");
  const chains = [["Ethereum", at("reveal", "Ethereum")], ["Base", at("reveal", "base")], ["BNB Chain", at("reveal", "BNB")], ["Arbitrum", at("reveal", "arbitrum")]] as const;
  const triad = [["bought", at("reveal", "bought")], ["fused", at("reveal", "fused")], ["proven", at("reveal", "proven")]] as const;
  const markUp = interpolate(frame, [tListing - 10, tListing + 14], [0, 1], { ...clamp, easing: easeInOut });
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AbsoluteFill style={{ opacity: interpolate(frame, [0, 20, knot, knot + 40], [0, 1, 1, 0.35], clamp) }}>
        <Warp intensity={interpolate(frame, [0, knot], [1.6, 0.6], clamp)} speed={interpolate(frame, [0, knot], [3.5, 0.8], clamp)} seed="rv" />
      </AbsoluteFill>
      <Glow r={interpolate(frame, [knot, knot + 20], [200, 900], clamp)} color={C.knot} opacity={interpolate(frame, [knot - 2, knot + 4, knot + 60], [0, 0.32, 0.08], clamp)} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `translateY(${-markUp * 330}px) scale(${1 - markUp * 0.55})` }}>
        <BigMark size={360} delay={8} draw={36} />
        <div style={{ marginTop: 20, fontFamily: F.brand, fontWeight: 500, fontSize: 150, letterSpacing: "-0.06em", color: C.text, opacity: interpolate(frame, [knot, knot + 14], [0, 1], clamp), transform: `translateY(${interpolate(frame, [knot, knot + 14], [30, 0], { ...clamp, easing: ease })}px)` }}>skein</div>
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingTop: 300 }}>
        <div style={{ opacity: interpolate(frame, [tListing - 6, tListing + 6], [1, 0], clamp) }}>
          <Words text="One request. Every thread." delay={tOne - 4} size={96} align="center" accent={["thread"]} />
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingTop: 300 }}>
        <div style={{ opacity: interpolate(frame, [tListing, tListing + 10], [0, 1], clamp), fontFamily: F.display, fontSize: 64, letterSpacing: "-0.03em", color: C.text }}>A listing verdict for any token.</div>
        <div style={{ display: "flex", gap: 22, marginTop: 40 }}>
          {chains.map(([name, t]) => {
            const p = useSpring(t - 3, { damping: 13 });
            return <div key={name} style={{ opacity: p, transform: `translateY(${(1 - p) * 30}px)`, fontFamily: F.mono, fontSize: 26, letterSpacing: "0.06em", padding: "12px 22px", border: `1px solid ${C.thread}`, color: C.thread, background: "rgba(46,230,200,0.06)" }}>{name}</div>;
          })}
        </div>
        <div style={{ display: "flex", gap: 60, marginTop: 70 }}>
          {triad.map(([w, t], i) => {
            const p = useSpring(t - 2, { damping: 12, stiffness: 160 });
            return <div key={w} style={{ opacity: p, transform: `scale(${0.8 + 0.2 * p})`, fontFamily: F.display, fontWeight: 300, fontSize: 104, letterSpacing: "-0.05em", color: i === 2 ? C.knot : C.text }}>{w}.</div>;
          })}
        </div>
      </AbsoluteFill>
      <Flash at={knot} color={C.knot} peak={0.25} len={14} />
      <Grain />
    </AbsoluteFill>
  );
};

/* 3 — The status quo: five vendors, five scores, five invoices, one tired analyst. */
const VENDORS = [
  { name: "Audit vendor", score: "61 / 100", inv: "$1,200 / mo" },
  { name: "Sanctions API", score: "Low risk", inv: "$900 / mo" },
  { name: "On-chain analytics", score: "B+", inv: "$2,400 / mo" },
  { name: "Liquidity feed", score: "0.42", inv: "$600 / mo" },
  { name: "Market surveillance", score: "Caution", inv: "$1,800 / mo" },
];
export const Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const s = scene("problem");
  const tV = at("problem", "vendors"), tS = at("problem", "scores"), tI = at("problem", "invoices");
  const tAn = at("problem", "analyst"), tSlow = at("problem", "slow"), tExp = at("problem", "expensive"), tProve = at("problem", "nobody");
  const broken = frame >= tProve;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Glow color={C.reject} opacity={broken ? 0.12 : 0.04} />
      <div style={{ position: "absolute", right: 60, top: 50 }}><Mono size={16}>Illustrative</Mono></div>
      <AbsoluteFill style={{ perspective: 2000 }}>
        {VENDORS.map((v, i) => {
          const p = useSpring(at("problem", "five") + i * 4, { damping: 14 });
          const ang = (i - 2) * 16;
          const x = 960 + (i - 2) * 330, y = 420 + Math.abs(i - 2) * 30 + Math.sin(frame / 30 + i) * 8;
          const fall = broken ? interpolate(frame - tProve - i * 3, [0, 24], [0, 1], { ...clamp, easing: easeInOut }) : 0;
          return (
            <div key={v.name} style={{ position: "absolute", left: x - 150, top: y - 130 + fall * 120, width: 300, height: 260, opacity: p * (1 - fall * 0.65), transform: `rotateY(${-ang}deg) translateZ(${-Math.abs(i - 2) * 120}px) scale(${0.85 + 0.15 * p})`, filter: broken ? `grayscale(${fall})` : undefined, background: "rgba(19,21,24,0.95)", border: `1px solid ${C.edge}`, padding: 22, boxShadow: "0 30px 80px rgba(0,0,0,0.6)" }}>
              <Mono size={16}>{v.name}</Mono>
              <div style={{ marginTop: 26, fontFamily: F.display, fontSize: 58, letterSpacing: "-0.04em", color: frame >= tS ? [C.escalate, C.approve, C.thread, C.text, C.reject][i] : C.muted, opacity: frame >= tS ? 1 : 0.2 }}>{v.score}</div>
              <div style={{ position: "absolute", bottom: 22, left: 22, right: 22, display: "flex", justifyContent: "space-between", fontFamily: F.mono, fontSize: 17, color: frame >= tI ? C.knot : "transparent" }}><span>INVOICE</span><span>{v.inv}</span></div>
            </div>
          );
        })}
        {/* the tangle */}
        <svg width="1920" height="1080" style={{ position: "absolute", opacity: interpolate(frame, [tS, tS + 12], [0, 0.55], clamp) * (broken ? 0.3 : 1) }}>
          {VENDORS.map((_, i) => (
            <path key={i} d={`M ${960 + (i - 2) * 330} 560 C ${960 + (i - 2) * 200} 760, ${960 - (i - 2) * 160} 700, 960 860`} fill="none" stroke={C.muted} strokeWidth={2} strokeDasharray="6 8" />
          ))}
        </svg>
      </AbsoluteFill>
      {/* the analyst */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 820, display: "flex", justifyContent: "center", gap: 70, alignItems: "baseline", opacity: interpolate(frame, [tAn - 4, tAn + 8], [0, 1], clamp) }}>
        <Mono size={24} color={C.text}>Analyst triage</Mono>
        <div style={{ fontFamily: F.display, fontWeight: 300, fontSize: 84, color: frame >= tSlow ? C.reject : C.text, letterSpacing: "-0.04em" }}>
          {String(Math.min(4, Math.floor(interpolate(frame, [tAn, tExp], [0, 4.2], clamp)))).padStart(2, "0")}h {String(Math.floor(interpolate(frame, [tAn, tExp + 20], [0, 712], clamp)) % 60).padStart(2, "0")}m
        </div>
        <div style={{ fontFamily: F.display, fontWeight: 300, fontSize: 84, color: C.knot, letterSpacing: "-0.04em", opacity: frame >= tExp ? 1 : 0 }}>$6,900 / mo</div>
      </div>
      {broken && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: 180 }}>
          <Glitch delay={tProve} len={10}>
            <div style={{ fontFamily: F.display, fontWeight: 400, fontSize: 112, letterSpacing: "-0.05em", color: C.text, textAlign: "center", lineHeight: 1.02 }}>Why was it<br /><span style={{ color: C.reject }}>decided?</span></div>
          </Glitch>
        </AbsoluteFill>
      )}
      <Flash at={tProve} color={C.reject} peak={0.25} />
      <Grain />
    </AbsoluteFill>
  );
};

/* 4 — How it works: one ask, five ranked miners, five escrow payments, five receipts. */
const NODES = [
  { check: "Contract audit", cue: "Contract", line: 0, ang: -52 },
  { check: "Sanctions", cue: "Sanctions", line: 3, ang: -26 },
  { check: "Holders", cue: "Holders", line: 1, ang: 0 },
  { check: "Liquidity", cue: "Liquidity", line: 2, ang: 26 },
  { check: "Wash trading", cue: "Wash", line: 4, ang: 52 },
];
export const How: React.FC = () => {
  const frame = useCurrentFrame();
  const tAsk = at("how", "asks"), tPlan = at("how", "plans"), tMiner = at("how", "miner"), tEsc = at("how", "escrow"), tRec = at("how", "receipt");
  const cx = 760, cy = 500, R = 560;
  const lines = data.approve.lines;
  const shown = NODES.filter((n) => frame >= at("how", n.cue) - 4).length;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Stripes opacity={0.12} />
      <Dust n={40} opacity={0.5} seed="how" />
      {/* the request */}
      <div style={{ position: "absolute", left: 70, top: 360, width: 440, opacity: useSpring(tAsk - 6), transform: `translateX(${(1 - useSpring(tAsk - 6)) * -60}px)` }}>
        <Mono size={18} color={C.thread}>[ → ] Request</Mono>
        <div style={{ marginTop: 14, padding: 22, border: `1px solid ${C.edge}`, background: "rgba(19,21,24,0.9)", fontFamily: F.mono, fontSize: 23, color: C.text, lineHeight: 1.7 }}>
          POST /v1/verdicts<br /><span style={{ color: C.muted }}>chain</span> 8453 · Base<br /><span style={{ color: C.muted }}>token</span> 0x9401…8631<br /><span style={{ color: C.muted }}>policy</span> dex-list@0.2.0
        </div>
      </div>
      {/* the plan */}
      <div style={{ position: "absolute", left: 90, top: 700, opacity: interpolate(frame, [tPlan, tPlan + 10], [0, 1], clamp) }}>
        <Mono size={22} color={C.text}>Plan · 5 checks · budget $0.08</Mono>
      </div>
      {/* the knot at the centre */}
      <div style={{ position: "absolute", left: cx - 90, top: cy - 90 }}>
        <BigMark size={180} delay={tAsk - 10} draw={24} />
      </div>
      {/* Telegraph network ring */}
      <svg width="1920" height="1080" style={{ position: "absolute" }}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke={C.edge} strokeWidth={1.5} strokeDasharray="4 10" opacity={interpolate(frame, [tMiner - 10, tMiner + 10], [0, 0.9], clamp)} />
        {NODES.map((n, i) => {
          const t = at("how", n.cue);
          const a = (n.ang * Math.PI) / 180;
          const x = cx + Math.cos(a) * R * 0.78, y = cy + Math.sin(a) * R * 0.78;
          const p = interpolate(frame - t + 6, [0, 14], [0, 1], { ...clamp, easing: easeInOut });
          const back = interpolate(frame - t - 14, [0, 18], [0, 1], { ...clamp, easing: easeInOut });
          return (
            <g key={n.check}>
              <line x1={cx} y1={cy} x2={cx + (x - cx) * p} y2={cy + (y - cy) * p} stroke={C.thread} strokeWidth={3} style={{ filter: `drop-shadow(0 0 8px ${C.thread})` }} />
              {/* the payment going out, the receipt coming back */}
              {p > 0 && p < 1 && <circle cx={cx + (x - cx) * p} cy={cy + (y - cy) * p} r={9} fill={C.knot} />}
              {back > 0 && back < 1 && <rect x={x + (cx - x) * back - 7} y={y + (cy - y) * back - 7} width={14} height={14} fill={C.approve} />}
            </g>
          );
        })}
      </svg>
      {NODES.map((n) => {
        const t = at("how", n.cue);
        const a = (n.ang * Math.PI) / 180;
        const x = cx + Math.cos(a) * R * 0.78, y = cy + Math.sin(a) * R * 0.78;
        const p = useSpring(t + 4, { damping: 13 });
        const l = lines[n.line]!;
        return (
          <div key={n.check} style={{ position: "absolute", left: x + 30, top: y - 56, opacity: p, transform: `scale(${0.8 + 0.2 * p})`, transformOrigin: "left center", background: "rgba(11,13,15,0.95)", border: `1px solid ${C.thread}`, padding: "12px 20px", boxShadow: `0 0 30px rgba(46,230,200,0.15)` }}>
            <div style={{ fontFamily: F.display, fontSize: 38, color: C.text, letterSpacing: "-0.02em" }}>{n.check}</div>
            <div style={{ fontFamily: F.mono, fontSize: 19, color: C.muted, marginTop: 4 }}>{l.miner} · ${l.amount.toFixed(2)}</div>
            <div style={{ fontFamily: F.mono, fontSize: 18, color: C.approve, marginTop: 4, opacity: frame >= t + 30 ? 1 : 0 }}>receipt {l.receipt.slice(0, 10)}…{l.receipt.slice(-4)}</div>
          </div>
        );
      })}
      {/* escrow and the receipts counter */}
      <div style={{ position: "absolute", left: 90, top: 210, opacity: interpolate(frame, [tEsc - 8, tEsc + 6], [0, 1], clamp) }}>
        <Mono size={18} color={C.knot}>Telegraph escrow · Ethereum Sepolia</Mono>
        <div style={{ fontFamily: F.display, fontWeight: 300, fontSize: 92, color: C.knot, letterSpacing: "-0.04em" }}>${(shown * 0.01).toFixed(2)}</div>
      </div>
      <div style={{ position: "absolute", left: 90, top: 780, opacity: interpolate(frame, [tRec - 6, tRec + 6], [0, 1], clamp) }}>
        <Mono size={18} color={C.approve}>Receipts</Mono>
        <div style={{ fontFamily: F.display, fontWeight: 300, fontSize: 92, color: C.approve, letterSpacing: "-0.04em" }}>{shown} / 5</div>
      </div>
      <Grain />
    </AbsoluteFill>
  );
};

/* 5 — The four decisions. */
const POLICY = `id: dex-list
version: 0.2.0
blockers:
  - { check: sanctions, status: FAIL }
  - { check: contract_audit, status: FAIL, minSeverity: 3 }
required: [contract_audit, sanctions, liquidity_depth, holder_count]
decision:
  approve_below_risk_bps: 3000
  min_confidence: 0.55`;
export const Decide: React.FC = () => {
  const frame = useCurrentFrame();
  const s = scene("decide");
  const tFour = at("decide", "four");
  const ds = [
    ["APPROVE", C.approve, at("decide", "Approve")],
    ["REJECT", C.reject, at("decide", "reject")],
    ["ESCALATE", C.escalate, at("decide", "escalate")],
    ["ABSTAIN", C.abstain, at("decide", "abstain")],
  ] as const;
  const tNever = at("decide", "Never");
  const codeOut = interpolate(frame, [tFour - 4, tFour + 10], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: codeOut, transform: `scale(${1 + (1 - codeOut) * 0.1})` }}>
        <CodeCard title="policies/dex-list@0.2.0.yaml · sha-256 locked" code={POLICY} delay={4} cps={160} width={1060} />
      </AbsoluteFill>
      <Shake hits={ds.map((d) => d[2])} amp={8}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 4 }}>
          {ds.map(([w, col, t]) => {
            const i = ds.findIndex((d) => d[0] === w);
            const p = interpolate(frame - (tFour + i * 3), [0, 8], [0, 1], { ...clamp, easing: ease });
            const active = frame >= t && (frame < (ds.find((d) => d[2] > t)?.[2] ?? tNever));
            return (
              <div key={w} style={{ opacity: p * (frame >= tNever ? 0.25 : active ? 1 : 0.22), transform: `translateX(${(1 - p) * 120}px) scale(${active ? 1.04 : 1})`, fontFamily: F.display, fontWeight: 400, fontSize: 150, letterSpacing: "-0.055em", lineHeight: 1.0, color: col, textShadow: active ? `0 0 50px ${col}88` : undefined }}>{w}</div>
            );
          })}
        </AbsoluteFill>
      </Shake>
      {frame >= tNever && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "rgba(0,0,0,0.75)", padding: "20px 50px" }}>
            <Words text="Never a guess." delay={tNever - 2} size={140} align="center" accent={["guess"]} accentColor={C.knot} />
          </div>
        </AbsoluteFill>
      )}
      {ds.map((d) => <Flash key={d[0]} at={d[2]} color={d[1]} peak={0.14} len={8} />)}
      <Grain />
    </AbsoluteFill>
  );
};
