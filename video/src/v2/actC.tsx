import React from "react";
import { AbsoluteFill, interpolate, random, Sequence, useCurrentFrame } from "remotion";
import { C, F } from "../theme";
import { clamp, ease, easeInOut, Grain, Stripes, useSpring, Warp, Words } from "../ui";
import data from "./data.json";
import { LAUNCHES } from "./actA";
import { BigMark, CodeCard, Dust, Flash, Glitch, Glow, Mono, Pic, Shake, Stage3D, Stamp, Type, Win } from "./kit";
import { at, scene } from "./tl";

/* 10 — Sniper: a verdict before every trade, and the backtest that made audit warnings a hard stop. */
export const Sniper: React.FC = () => {
  const frame = useCurrentFrame();
  const s = scene("sniper");
  const tWatch = at("sniper", "watches"), tBuys = at("sniper", "buys"), tBack = at("sniper", "backtest"), tZero = at("sniper", "zero"), t22 = at("sniper", "22"), tStop = at("sniper", "hard");
  const segB = tBack - 6;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Sequence durationInFrames={segB + 8}>
        <Stripes opacity={0.14} />
        <Stage3D dur={segB} from={{ ry: 12, rx: 5, s: 0.98, z: -60 }} to={{ ry: 5, rx: 2, s: 1.04 }} style={{ left: 280 }}>
          <Win url="sniper · Skein Sniper · Base" live width={1300} height={760}>
            <Pic src="v2/shots/sniper.png" dur={segB} from={[1, 0, 0]} to={[1.1, 0.1, 0.4]} width={1300} height={760} aspect={0.5625} />
          </Win>
        </Stage3D>
        {/* the radar of launches */}
        <div style={{ position: "absolute", left: 80, top: 190, width: 520, height: 520, opacity: interpolate(frame, [tWatch - 6, tWatch + 8], [0, 1], clamp) }}>
          <svg width="520" height="520" style={{ position: "absolute" }}>
            {[80, 160, 240].map((r) => <circle key={r} cx={260} cy={260} r={r} fill="none" stroke={C.threadDeep} strokeWidth={1.5} />)}
            <line x1={260} y1={260} x2={260 + Math.cos(frame / 9) * 250} y2={260 + Math.sin(frame / 9) * 250} stroke={C.thread} strokeWidth={3} style={{ filter: `drop-shadow(0 0 10px ${C.thread})` }} />
          </svg>
          {LAUNCHES.slice(0, 16).map((l, i) => {
            const a = random(`ra${i}`) * Math.PI * 2, r = 60 + random(`rr${i}`) * 180;
            const born = tWatch + i * 5;
            const o = interpolate(frame, [born, born + 6], [0, 1], clamp);
            const checked = frame >= tBuys + i * 2;
            return <div key={l.s} style={{ position: "absolute", left: 260 + Math.cos(a) * r - 40, top: 260 + Math.sin(a) * r - 12, opacity: o, fontFamily: F.mono, fontSize: 15, color: checked ? C.thread : C.muted, background: "rgba(0,0,0,0.75)", padding: "2px 6px", border: `1px solid ${checked ? C.thread : C.edge}` }}>{l.s}</div>;
          })}
        </div>
        <div style={{ position: "absolute", left: 80, top: 80 }}><Mono size={22} color={C.thread}>[ → ] Mission 14 · Skein Sniper · no APPROVE, no trade</Mono></div>
      </Sequence>
      <Sequence from={segB}>
        <AbsoluteFill style={{ padding: "100px 140px" }}>
          <Mono size={22} color={C.thread}>[ → ] Backtest · 106 answered Sniper verdicts · eval/FINDINGS-sniper.md</Mono>
          {[
            { label: "Contract audit WARN", n: 23, bad: 22, y: 0 },
            { label: "Contract audit PASS", n: 69, bad: 8, y: 1 },
          ].map((row) => {
            const p = useSpring(10 + row.y * 8);
            return (
              <div key={row.label} style={{ marginTop: row.y === 0 ? 60 : 50, opacity: p }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", width: 1640 }}>
                  <div style={{ fontFamily: F.display, fontSize: 44, color: C.text }}>{row.label}</div>
                  <Mono size={20}>{row.n} launches · {row.bad} went to zero</Mono>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 14, width: 1640 }}>
                  {Array.from({ length: row.n }, (_, i) => {
                    const turn = tZero - segB + (i / row.n) * 26;
                    const red = i < row.bad && frame - segB >= turn;
                    return <div key={i} style={{ width: row.n > 30 ? 18 : 62, height: row.n > 30 ? 18 : 62, background: red ? C.reject : "rgba(46,230,200,0.18)", border: `1px solid ${red ? C.reject : C.threadDeep}`, boxShadow: red ? `0 0 14px ${C.reject}` : undefined }} />;
                  })}
                </div>
              </div>
            );
          })}
          <div style={{ position: "absolute", right: 150, top: 560, textAlign: "right", opacity: interpolate(frame - segB, [t22 - segB - 4, t22 - segB + 6], [0, 1], clamp) }}>
            <div style={{ fontFamily: F.display, fontWeight: 300, fontSize: 210, letterSpacing: "-0.06em", color: C.reject, lineHeight: 1 }}>22 / 23</div>
            <Mono size={20} color={C.text}>audit warnings that went to zero</Mono>
          </div>
        </AbsoluteFill>
        <Shake hits={[tStop - segB]} amp={12}>
          <AbsoluteFill style={{ alignItems: "flex-start", justifyContent: "flex-end", padding: "0 0 150px 140px" }}>
            {frame >= tStop - 2 && (
              <div>
                <Stamp text="HARD STOP" delay={tStop - segB - 2} color={C.reject} size={96} rotate={-5} />
                <div style={{ marginTop: 22, fontFamily: F.mono, fontSize: 22, color: C.text }}>
                  <Type text="- { check: contract_audit, status: WARN }   # agent-pretrade@0.3.0" delay={tStop - segB + 6} cps={70} />
                </div>
              </div>
            )}
          </AbsoluteFill>
        </Shake>
      </Sequence>
      <Flash at={tStop} color={C.reject} peak={0.2} />
      <Grain />
    </AbsoluteFill>
  );
};

/* 11 — The prospective benchmark, out of sample: labelled 72 hours later. */
export const Bench: React.FC = () => {
  const frame = useCurrentFrame();
  const s = scene("bench");
  const t72 = at("bench", "72"), t40 = at("bench", "40"), t27 = at("bench", "27"), tNone = at("bench", "approved"), tSimpler = at("bench", "Simpler");
  const climax = frame >= tNone - 1;
  const gridOut = interpolate(frame, [tSimpler - 6, tSimpler + 8], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Glow color={climax ? C.thread : C.reject} opacity={climax ? interpolate(frame, [tNone, tNone + 30], [0.4, 0.14], clamp) : interpolate(frame, [t27, t27 + 20], [0, 0.1], clamp)} />
      <AbsoluteFill style={{ padding: "100px 140px" }}>
        <Mono size={22} color={C.thread}>[ → ] Prospective benchmark · out of sample · published daily to data/prospective</Mono>
        {/* the 72-hour clock */}
        <div style={{ display: "flex", alignItems: "center", gap: 30, marginTop: 50, opacity: interpolate(frame, [t72 - 20, t72 - 6], [0, 1], clamp) * gridOut }}>
          <Mono size={22} color={C.text}>verdict</Mono>
          <div style={{ width: 900, height: 4, background: C.edge, position: "relative" }}>
            <div style={{ position: "absolute", inset: 0, width: `${interpolate(frame, [t72 - 6, t72 + 24], [0, 100], { ...clamp, easing: easeInOut })}%`, background: C.thread, boxShadow: `0 0 16px ${C.thread}` }} />
          </div>
          <div style={{ fontFamily: F.display, fontWeight: 300, fontSize: 80, color: C.thread, letterSpacing: "-0.04em" }}>{Math.round(interpolate(frame, [t72 - 6, t72 + 24], [0, 72], clamp))} h</div>
          <Mono size={22} color={C.text}>outcome</Mono>
        </div>
        {/* the forty launches */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 92px)", gap: 14, marginTop: 50, opacity: gridOut }}>
          {Array.from({ length: 40 }, (_, i) => {
            const born = t40 - 10 + i * 0.6;
            const o = interpolate(frame, [born, born + 5], [0, 1], clamp);
            const bad = i < 27;
            const red = bad && frame >= t27 + i * 0.5;
            const saved = climax && bad;
            return <div key={i} style={{ height: 70, opacity: o, background: red ? (saved ? "rgba(255,93,93,0.12)" : "rgba(255,93,93,0.22)") : "rgba(138,150,163,0.12)", border: `1px solid ${red ? C.reject : C.edge}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.mono, fontSize: 18, color: saved ? C.thread : red ? C.reject : C.muted }}>{saved ? "✕ skip" : red ? "bad" : "?"}</div>;
          })}
        </div>
      </AbsoluteFill>
      {climax && frame < tSimpler && (
        <AbsoluteFill style={{ alignItems: "flex-end", justifyContent: "center", paddingRight: 150 }}>
          <div style={{ textAlign: "right", transform: `scale(${interpolate(frame - tNone, [0, 6], [1.3, 1], { ...clamp, easing: ease })})` }}>
            <Mono size={22} color={C.text}>bad launches Skein approved</Mono>
            <div style={{ fontFamily: F.display, fontWeight: 300, fontSize: 330, letterSpacing: "-0.07em", color: C.thread, lineHeight: 0.95, textShadow: `0 0 80px ${C.thread}88` }}>0</div>
            <Mono size={20}>of 27</Mono>
          </div>
        </AbsoluteFill>
      )}
      {frame >= tSimpler - 4 && (
        <AbsoluteFill style={{ padding: "330px 160px 0" }}>
          <Mono size={20}>Bad launches approved · same paid findings, Nov 11, 2026 · 40 launches, 27 bad, 13 ambiguous</Mono>
          {[
            ["Single best miner", 22.2, C.reject],
            ["Weighted average", 22.2, C.reject],
            ["Skein", 0.0, C.thread],
          ].map(([name, v, col], i) => {
            const p = interpolate(frame - tSimpler - i * 6, [0, 22], [0, 1], { ...clamp, easing: ease });
            return (
              <div key={name as string} style={{ display: "flex", alignItems: "center", gap: 30, marginTop: 44 }}>
                <div style={{ width: 420, fontFamily: F.display, fontSize: 48, color: i === 2 ? C.thread : C.text }}>{name}</div>
                <div style={{ width: (v as number) * 40 * p + 6, height: 64, background: col as string, boxShadow: `0 0 26px ${col}66` }} />
                <div style={{ fontFamily: F.display, fontWeight: 300, fontSize: 72, color: col as string, letterSpacing: "-0.04em" }}>{((v as number) * p).toFixed(1)}%</div>
              </div>
            );
          })}
        </AbsoluteFill>
      )}
      <Flash at={tNone} color={C.thread} peak={0.45} len={14} />
      <Grain />
    </AbsoluteFill>
  );
};

/* 12 — Production: replicas, caps, the probe, backups, the status page. */
export const Prod: React.FC = () => {
  const frame = useCurrentFrame();
  const s = scene("prod");
  const items = [
    { cue: "two", title: "2 API replicas", sub: "least-privilege database role", icon: "servers" },
    { cue: "hard", title: "Hard spend caps", sub: "$0.05 a call · $0.20 a verdict · $10 a day", icon: "gauge" },
    { cue: "probe", title: "Probe every 10 min", sub: "pages a human on ntfy", icon: "pulse" },
    { cue: "nightly", title: "Nightly backups", sub: "pg_dump · 03:17 UTC", icon: "moon" },
    { cue: "public", title: "Public status page", sub: "7 of 8 checks live", icon: "status" },
  ];
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AbsoluteFill style={{ opacity: 0.22 }}><Pic src="v2/shots/web-status.png" dur={s.dur} from={[1.05, 0.5, 0.2]} to={[1.15, 0.5, 0.4]} width={1920} height={1080} /></AbsoluteFill>
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.6), rgba(0,0,0,0.92))" }} />
      <AbsoluteFill style={{ padding: "90px 120px" }}>
        <Words text="It runs like production." delay={4} size={96} accent={["production"]} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 24, marginTop: 70 }}>
          {items.map((it, i) => {
            const t = at("prod", it.cue);
            const p = useSpring(t - 4, { damping: 13 });
            const live = frame >= t;
            return (
              <div key={it.title} style={{ height: 470, opacity: p, transform: `translateY(${(1 - p) * 60}px)`, background: "rgba(19,21,24,0.92)", border: `1px solid ${live ? C.thread : C.edge}`, boxShadow: live ? `0 0 40px rgba(46,230,200,0.12)` : undefined, padding: 26, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <svg width="200" height="160" viewBox="0 0 200 160">
                  {it.icon === "servers" && [0, 1].map((k) => (
                    <g key={k} transform={`translate(${20 + k * 90} 20)`}>
                      <rect width="70" height="120" fill="none" stroke={C.thread} strokeWidth="3" />
                      {[0, 1, 2].map((r) => <rect key={r} x="10" y={14 + r * 34} width="50" height="20" fill={C.threadDeep} />)}
                      <circle cx="35" cy="108" r="5" fill={C.approve} opacity={0.4 + 0.6 * Math.abs(Math.sin((frame + k * 9) / 7))} />
                    </g>
                  ))}
                  {it.icon === "gauge" && (
                    <g>
                      <path d="M30 130 A70 70 0 0 1 170 130" fill="none" stroke={C.edge} strokeWidth="14" />
                      <path d="M30 130 A70 70 0 0 1 170 130" fill="none" stroke={C.knot} strokeWidth="14" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - interpolate(frame - t, [0, 20], [0, 0.62], clamp)} />
                      <line x1="100" y1="130" x2={100 + Math.cos(Math.PI + interpolate(frame - t, [0, 20], [0, 0.62], clamp) * Math.PI) * 60} y2={130 + Math.sin(Math.PI + interpolate(frame - t, [0, 20], [0, 0.62], clamp) * Math.PI) * 60} stroke={C.text} strokeWidth="4" />
                    </g>
                  )}
                  {it.icon === "pulse" && (
                    <g>
                      {[0, 1, 2].map((k) => { const ph = ((frame - t + k * 12) % 36) / 36; return <circle key={k} cx="100" cy="80" r={10 + ph * 60} fill="none" stroke={C.thread} strokeWidth="3" opacity={live ? 1 - ph : 0} />; })}
                      <circle cx="100" cy="80" r="10" fill={C.thread} />
                    </g>
                  )}
                  {it.icon === "moon" && (
                    <g>
                      <path d="M120 30 A55 55 0 1 0 150 110 A45 45 0 1 1 120 30" fill={C.knot} opacity="0.9" />
                      {[0, 1, 2].map((k) => <ellipse key={k} cx="70" cy={104 + k * 14} rx="45" ry="8" fill="none" stroke={C.thread} strokeWidth="3" />)}
                    </g>
                  )}
                  {it.icon === "status" && [0, 1, 2, 3, 4, 5, 6, 7].map((k) => <rect key={k} x={14 + k * 22} y="40" width="16" height="80" fill={k === 4 ? C.edge : C.approve} opacity={frame >= t + k * 2 ? 1 : 0.15} />)}
                </svg>
                <div>
                  <div style={{ fontFamily: F.display, fontSize: 36, letterSpacing: "-0.02em", color: C.text, lineHeight: 1.1 }}>{it.title}</div>
                  <div style={{ fontFamily: F.mono, fontSize: 16, color: C.muted, marginTop: 12, lineHeight: 1.5 }}>{it.sub}</div>
                </div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
      {/* the page that reaches a phone */}
      <div style={{ position: "absolute", right: 120, top: 70, width: 470, opacity: useSpring(at("prod", "pages") - 2), transform: `translateY(${(1 - useSpring(at("prod", "pages") - 2)) * -40}px)`, background: "rgba(242,244,245,0.97)", padding: "16px 20px", boxShadow: "0 30px 80px rgba(0,0,0,0.6)" }}>
        <div style={{ fontFamily: F.mono, fontSize: 14, color: C.ink2, letterSpacing: "0.06em" }}>NTFY · SKEIN-PROBE · NOW</div>
        <div style={{ fontFamily: F.display, fontSize: 24, color: C.ink, marginTop: 6 }}>probe:purchases recovered</div>
        <div style={{ fontFamily: F.display, fontSize: 18, color: C.ink2, marginTop: 2 }}>Upstream purchases is back to normal</div>
      </div>
      <Grain />
    </AbsoluteFill>
  );
};

/* 13 — Integrate: REST, the SDK, MCP, x402 and Telegraph itself. */
const CARDS = [
  { cue: "rest", title: "REST", code: `curl -X POST api.skeinlabs.site/v1/verdicts \\\n  -H "authorization: Bearer $SKEIN_API_KEY" \\\n  -d '{"subject":{"chainId":8453,"token":"0x…"}}'` },
  { cue: "TypeScript", title: "@skeinlabs/sdk", code: `const v = await skein.verdict({\n  subject: { chainId: 8453, token },\n  policy: "dex-list@0.2.0",\n});\nif (v.verdict !== "APPROVE") review(v.reasons);` },
  { cue: "MCP", title: "MCP · Claude, Cursor", code: `"skein": {\n  "command": "npx",\n  "args": ["-y", "@skeinlabs/mcp"]\n}` },
  { cue: "X402", title: "x402 · pay per verdict", code: `POST /v1/verdicts\n← 402 Payment Required\nX-PAYMENT: <signed USDC authorization>\n← 200 · X-PAYMENT-RESPONSE` },
  { cue: "ask", title: "Telegraph · miner 845301", code: `POST /engine/v1/ask/845301\n{ "token": "0x…", "chain": "base" }\n→ verdict · risk_level · signals` },
];
export const Integrate: React.FC = () => {
  const frame = useCurrentFrame();
  const pos = [[110, 110], [990, 110], [110, 470], [990, 470], [550, 770]];
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Stripes opacity={0.1} />
      <Dust n={30} opacity={0.4} seed="int" />
      {CARDS.map((c, i) => {
        const t = at("integrate", c.cue);
        return (
          <div key={c.title} style={{ position: "absolute", left: pos[i]![0], top: pos[i]![1] }}>
            <CodeCard title={c.title} code={c.code} delay={t - 6} width={820} cps={120} accent={i === 4 ? C.knot : C.thread} />
          </div>
        );
      })}
      <Grain />
    </AbsoluteFill>
  );
};

/* 14 — Outro. */
export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const s = scene("outro");
  const tOne = at("outro", "one"), tTry = at("outro", "Try");
  const out = interpolate(frame, [s.dur - 40, s.dur - 4], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: "#000", opacity: out }}>
      <Warp intensity={0.7} speed={interpolate(frame, [0, 40], [2.5, 0.6], clamp)} seed="out" />
      <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 45%, rgba(0,0,0,0.2) 0, rgba(0,0,0,0.85) 60%)" }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: 140 }}>
        <BigMark size={260} delay={4} draw={30} />
        <div style={{ fontFamily: F.brand, fontWeight: 500, fontSize: 130, letterSpacing: "-0.06em", color: C.text, marginTop: 10, opacity: interpolate(frame, [20, 34], [0, 1], clamp) }}>skein</div>
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 230 }}>
        <Words text="One request. Every thread." delay={tOne - 4} size={72} align="center" accent={["thread"]} />
        <div style={{ marginTop: 36, opacity: useSpring(tTry - 2), transform: `scale(${0.9 + 0.1 * useSpring(tTry - 2)})`, fontFamily: F.display, fontSize: 48, color: C.ink, background: C.thread, padding: "14px 40px", boxShadow: `0 0 60px ${C.thread}88` }}>skeinlabs.site</div>
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 120, opacity: interpolate(frame, [tTry + 20, tTry + 36], [0, 1], clamp) }}>
        <Mono size={18}>npm i @skeinlabs/sdk · npx -y @skeinlabs/mcp · Telegraph miner 845301 · github.com/linoxbt/skein</Mono>
      </AbsoluteFill>
      <Flash at={34} color={C.knot} peak={0.2} len={14} />
      <Grain />
    </AbsoluteFill>
  );
};
