import React from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame } from "remotion";
import { C, F } from "../theme";
import { said, scene } from "../timeline";
import { clamp, Count, ease, Grain, Mark, Rule, Tag, useSpring, Warp, Words } from "../ui";

const TICKERS = ["PEPE2", "MOONX", "SAFU", "DOGEAI", "BASED", "ELONCAT", "TRUMP47", "RICH", "WAGMI", "GIGA", "FROGZ", "LAMBO", "TURBO", "BONK2", "AIGOD", "MEOW", "SHIBX", "HODL", "PUMP", "NEIRO2", "GOAT", "VIRAL", "RUGME", "ALPHA", "CHAD", "BRETT2", "MOCHI", "TOSHI2", "DEGEN2", "KEKW"];
const FLAGS = ["HONEYPOT", "RUG PULL", "MINTABLE", "WASH TRADED", "SANCTIONED", "99% IN ONE WALLET", "NO LIQUIDITY", "SELL TAX 90%"];

/** 0. Thousands of launches, most of them traps; one question. */
export const Cold: React.FC = () => {
  const frame = useCurrentFrame();
  const s = scene("cold");
  const tTrap = said("cold", "Most of them");
  const tWho = said("cold", "If you run");
  const tQ = said("cold", "Is this token");
  const clear = interpolate(frame, [tQ - 20, tQ], [1, 0], clamp);
  const chips = Array.from({ length: 70 }, (_, i) => {
    const born = 8 + i * 4.2;
    const age = frame - born;
    if (age < 0) return null;
    const x = 80 + random(`x${i}`) * 1700;
    const y = 1100 - ((age * (1.6 + random(`v${i}`) * 1.8)) % 1300);
    const trap = i % 3 !== 0 && frame > tTrap + (i % 7) * 4;
    const glitch = trap && (frame + i) % 23 < 2;
    const o = Math.min(1, age / 10) * clear * (0.45 + random(`o${i}`) * 0.55);
    return (
      <div key={i} style={{ position: "absolute", left: x + (glitch ? 8 : 0), top: y, fontFamily: F.mono, fontSize: 20 + random(`s${i}`) * 10, opacity: o, color: trap ? C.reject : C.muted, border: `1px solid ${trap ? "rgba(255,93,93,0.6)" : C.edge}`, background: trap ? "rgba(255,93,93,0.08)" : "rgba(19,21,24,0.7)", padding: "6px 12px", whiteSpace: "nowrap", transform: glitch ? "skewX(-12deg)" : undefined }}>
        ${TICKERS[i % TICKERS.length]}
        {trap && <span style={{ marginLeft: 10, fontSize: 15, letterSpacing: "0.08em" }}>{FLAGS[i % FLAGS.length]}</span>}
      </div>
    );
  });
  const whoP = (k: number) => useSpring(tWho + k * 14);
  const q = interpolate(frame, [tQ - 4, tQ + 14], [0, 1], { ...clamp, easing: ease });
  return (
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 60%, #0b1214 0%, #000 70%)" }}>
      {chips}
      <div style={{ position: "absolute", left: 90, top: 80, opacity: clear }}>
        <Tag delay={6}>New token pools on Base · last 24h</Tag>
        <div style={{ fontFamily: F.display, fontSize: 150, fontWeight: 300, letterSpacing: "-0.05em", color: C.text, marginTop: 18 }}>
          <Count to={1629} delay={10} dur={70} />
        </div>
      </div>
      <div style={{ position: "absolute", right: 90, top: 96, display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-end", opacity: clear }}>
        {["Exchanges", "Launchpads", "Trading agents"].map((w, k) => {
          const p = whoP(k);
          return <div key={w} style={{ fontFamily: F.display, fontSize: 56, fontWeight: 400, letterSpacing: "-0.03em", color: C.text, opacity: p, transform: `translateX(${(1 - p) * 40}px)` }}>{w}</div>;
        })}
      </div>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: q }}>
        <div style={{ textAlign: "center", transform: `scale(${0.94 + q * 0.06})` }}>
          <Words text="Is this token" delay={tQ - 2} size={150} align="center" />
          <Words text="fit to list?" delay={tQ + 8} size={150} align="center" accent={["list?"]} accentColor={C.knot} />
        </div>
      </AbsoluteFill>
      <Grain />
      {frame > s.dur - 8 && <AbsoluteFill style={{ background: "#fff", opacity: interpolate(frame, [s.dur - 8, s.dur - 2, s.dur], [0, 0.85, 0], clamp) }} />}
    </AbsoluteFill>
  );
};

/** 1. Logo reveal on the hero warp. */
export const Reveal: React.FC = () => {
  const frame = useCurrentFrame();
  const s = scene("reveal");
  const word = useSpring(40, { damping: 16 });
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Warp speed={interpolate(frame, [0, 40, 80], [3.2, 1.2, 0.9], clamp)} intensity={interpolate(frame, [0, 20], [0.2, 1], clamp)} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 44 }}>
          <Mark size={260} delay={4} drawFrames={32} />
          <div style={{ fontFamily: F.brand, fontWeight: 500, fontSize: 230, letterSpacing: "-0.06em", color: C.text, opacity: word, transform: `translateX(${(1 - word) * -40}px)`, clipPath: `inset(0 ${(1 - word) * 100}% 0 0)` }}>skein</div>
        </div>
        <div style={{ marginTop: 40, height: 120 }}>
          <Words text="One request. Every thread." delay={s.voFrom + 18} size={96} stagger={5} align="center" accent={["thread."]} />
        </div>
      </AbsoluteFill>
      <Grain />
    </AbsoluteFill>
  );
};

const VENDORS = [
  { name: "Contract audit vendor", metric: "Score 61 / 100", x: 120, y: 160, r: -3 },
  { name: "Sanctions API", metric: "2 fuzzy matches", x: 700, y: 110, r: 2 },
  { name: "Holder analytics", metric: "Top 10: 71%", x: 1270, y: 190, r: -2 },
  { name: "DEX liquidity feed", metric: "$184,220", x: 300, y: 560, r: 3 },
  { name: "Wash-trade monitor", metric: "Suspicious: maybe", x: 1000, y: 600, r: -4 },
];

/** 2. Five vendors, five dashboards, hours of triage, no trail. */
export const Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const tHours = said("problem", "hours of analyst");
  const tNobody = said("problem", "nobody can show");
  const decay = interpolate(frame, [tNobody, tNobody + 20], [0, 1], clamp);
  const mins = Math.floor(interpolate(frame, [tHours, tHours + 120], [0, 252], clamp));
  return (
    <AbsoluteFill style={{ background: "#07090b" }}>
      {VENDORS.map((v, i) => {
        const p = useSpring(8 + i * 9, { damping: 14 });
        const shake = decay * Math.sin(frame * 1.7 + i) * 4;
        return (
          <div key={v.name} style={{ position: "absolute", left: v.x + shake, top: v.y, width: 520, height: 330, transform: `rotate(${v.r * p}deg) scale(${0.8 + 0.2 * p})`, opacity: p * (1 - decay * 0.55), background: C.panel, border: `1px solid ${C.edge}`, boxShadow: "0 30px 80px rgba(0,0,0,0.6)", filter: `grayscale(${decay})` }}>
            <div style={{ height: 40, borderBottom: `1px solid ${C.edge}`, display: "flex", alignItems: "center", padding: "0 16px", fontFamily: F.mono, fontSize: 16, color: C.muted, gap: 8 }}>
              <span style={{ width: 10, height: 10, background: ["#ff5d5d", "#f2b84b", "#5b8def", "#b06cf0", "#3ddc84"][i] }} /> {v.name}
            </div>
            <div style={{ padding: 22 }}>
              <div style={{ fontFamily: F.display, fontSize: 48, color: C.text, letterSpacing: "-0.03em" }}>{v.metric}</div>
              <svg width="476" height="150" style={{ marginTop: 14 }}>
                <polyline fill="none" stroke={["#ff5d5d", "#f2b84b", "#5b8def", "#b06cf0", "#3ddc84"][i]} strokeWidth="3" points={Array.from({ length: 24 }, (_, k) => `${k * 20},${75 + Math.sin(k * 0.9 + i * 2 + frame / 14) * 30 + random(`p${i}${k}`) * 30}`).join(" ")} />
              </svg>
            </div>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 120, bottom: 80, opacity: interpolate(frame, [tHours - 6, tHours + 6], [0, 1], clamp) }}>
        <Tag color={C.knot}>Analyst triage</Tag>
        <div style={{ fontFamily: F.mono, fontSize: 92, color: C.knot, marginTop: 12 }}>{String(Math.floor(mins / 60)).padStart(2, "0")}h {String(mins % 60).padStart(2, "0")}m</div>
      </div>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: decay }}>
        <div style={{ border: `4px solid ${C.reject}`, color: C.reject, fontFamily: F.mono, fontSize: 84, letterSpacing: "0.1em", padding: "18px 40px", transform: `rotate(-6deg) scale(${1.6 - decay * 0.6})`, background: "rgba(0,0,0,0.6)", boxShadow: "0 0 60px rgba(255,93,93,0.35)" }}>NO AUDIT TRAIL</div>
      </AbsoluteFill>
      <Grain />
    </AbsoluteFill>
  );
};

export const MINERS = [
  { check: "Contract audit", intent: "SMART_CONTRACT_AUDIT", miner: "GoPlus Security", cue: "smart contract audit" },
  { check: "Sanctions", intent: "SANCTIONS_SCREENING", miner: "OFAC SDN Entity Screen", cue: "Sanctions screening" },
  { check: "Holders", intent: "TOKEN_HOLDER_COUNT", miner: "TxLens", cue: "Holder distribution" },
  { check: "Liquidity", intent: "LIQUIDITY_DEPTH_VERIFY", miner: "VerifyWire Liquidity", cue: "Liquidity depth" },
  { check: "Wash trading", intent: "WASH_TRADING_DETECTION", miner: "VerifyWire Wash Trading", cue: "wash trading detection" },
];

/** 3. Skein buys ranked intelligence from miners, paid through the escrow. */
export const How: React.FC = () => {
  const frame = useCurrentFrame();
  const tAsk = said("how", "Ask it about");
  const tPay = said("how", "Every check is paid");
  const cx = 960, cy = 600, R = 380;
  const intro = interpolate(frame, [tAsk - 10, tAsk + 10], [1, 0], clamp);
  const net = interpolate(frame, [tAsk - 6, tAsk + 14], [0, 1], { ...clamp, easing: ease });
  const nodes = MINERS.map((m, i) => {
    const a = -Math.PI / 2 + (i - 2) * 0.62;
    return { ...m, x: cx + Math.cos(a) * R * 1.55, y: cy + Math.sin(a) * R + 40, t: said("how", m.cue, -0.3) };
  });
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <svg width="1920" height="1080" style={{ position: "absolute", opacity: 0.35 }}>
        {Array.from({ length: 33 }, (_, i) => <line key={`v${i}`} x1={i * 60} y1={0} x2={i * 60} y2={1080} stroke="#11161a" />)}
        {Array.from({ length: 19 }, (_, i) => <line key={`h${i}`} x1={0} y1={i * 60} x2={1920} y2={i * 60} stroke="#11161a" />)}
      </svg>
      <AbsoluteFill style={{ justifyContent: "center", padding: "0 140px", opacity: intro }}>
        <Tag delay={4}>How it works</Tag>
        <div style={{ height: 24 }} />
        <Words text="A decision engine, built on Telegraph." delay={10} size={120} accent={["Telegraph."]} />
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: net }}>
        <svg width="1920" height="1080" style={{ position: "absolute" }}>
          {nodes.map((n, i) => {
            const p = interpolate(frame, [n.t, n.t + 16], [0, 1], { ...clamp, easing: ease });
            const path = `M${cx},${cy} C${cx},${(cy + n.y) / 2} ${n.x},${(cy + n.y) / 2 + 60} ${n.x},${n.y}`;
            return <path key={i} d={path} fill="none" stroke={C.thread} strokeWidth={2.5} pathLength={1} strokeDasharray="1" strokeDashoffset={1 - p} opacity={0.8} style={{ filter: "drop-shadow(0 0 6px rgba(46,230,200,0.6))" }} />;
          })}
          {frame > tPay &&
            nodes.map((n, i) => {
              const k = ((frame - tPay - i * 5) % 40) / 40;
              const tt = Math.max(0, Math.min(1, k));
              const bx = (1 - tt) ** 3 * cx + 3 * (1 - tt) ** 2 * tt * cx + 3 * (1 - tt) * tt ** 2 * n.x + tt ** 3 * n.x;
              const by = (1 - tt) ** 3 * cy + 3 * (1 - tt) ** 2 * tt * ((cy + n.y) / 2) + 3 * (1 - tt) * tt ** 2 * ((cy + n.y) / 2 + 60) + tt ** 3 * n.y;
              return <circle key={i} cx={bx} cy={by} r={9} fill={C.knot} style={{ filter: "drop-shadow(0 0 10px rgba(242,184,75,0.9))" }} />;
            })}
        </svg>
        {nodes.map((n, i) => {
          const p = useSpring(n.t, { damping: 13, stiffness: 150 });
          return (
            <div key={i} style={{ position: "absolute", left: n.x - 170, top: n.y - 70, width: 340, opacity: p, transform: `scale(${0.6 + 0.4 * p})`, background: C.panel, border: `1px solid ${p > 0.9 ? C.thread : C.edge}`, padding: "16px 20px", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
              <div style={{ fontFamily: F.mono, fontSize: 15, color: C.thread, letterSpacing: "0.06em" }}>{n.intent}</div>
              <div style={{ fontFamily: F.display, fontSize: 40, color: C.text, letterSpacing: "-0.03em", marginTop: 4 }}>{n.check}</div>
              <div style={{ fontFamily: F.mono, fontSize: 16, color: C.muted, marginTop: 4 }}>miner · {n.miner}</div>
              {frame > tPay + i * 5 && <div style={{ position: "absolute", right: 14, top: 14, fontFamily: F.mono, fontSize: 18, color: C.knot }}>$0.010</div>}
            </div>
          );
        })}
        <div style={{ position: "absolute", left: cx - 90, top: cy - 90, width: 180, height: 180, borderRadius: 90, background: "radial-gradient(circle, #0f2a27 0%, #000 70%)", border: `2px solid ${C.thread}`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 ${40 + Math.sin(frame / 8) * 10}px rgba(46,230,200,0.45)` }}>
          <Mark size={110} delay={tAsk - 6} drawFrames={20} glow={false} />
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 70, display: "flex", justifyContent: "center", opacity: interpolate(frame, [tPay, tPay + 12], [0, 1], clamp) }}>
          <Tag color={C.knot}>Telegraph escrow · USDC · machine to machine</Tag>
        </div>
      </AbsoluteFill>
      <Grain />
    </AbsoluteFill>
  );
};

export { Rule };
