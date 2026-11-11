import React from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import { C, F, FPS } from "../theme";
import { clamp, ease, easeInOut, Grain, Stripes, useSpring, Words } from "../ui";
import data from "./data.json";
import { Callout, Clip, Dust, Flash, Glitch, Glow, Mono, Pic, Shake, Stage3D, Stamp, Type, Win } from "./kit";
import { at, scene } from "./tl";

const A = data.approve;
const short = (h: string, a = 6, b = 4) => `${h.slice(0, a)}…${h.slice(-b)}`;
const CHECK_NAME: Record<string, string> = { contract_audit: "Contract audit", holder_count: "Holders", liquidity_depth: "Liquidity", sanctions: "Sanctions", wash_trading: "Wash trading" };

/* 6 — Live, on the Desk: a real application decided by a real verdict. */
export const Desk: React.FC = () => {
  const frame = useCurrentFrame();
  const s = scene("desk");
  const tBuys = at("desk", "buys");
  const tRec = at("desk", "Five"), tSec = at("desk", "Five", { nth: 1 }), tCents = at("desk", "Five", { nth: 2 });
  const tApproved = at("desk", "Approved");
  const segA = { from: 0, len: tBuys - 4 }; // typing the application, submitting it
  const segB = { from: segA.len, len: tApproved - 8 - segA.len }; // the agent buying, receipts landing
  const segC = { from: tApproved - 8 }; // the decided application
  // receipts land at their real completion times, compressed onto the narration
  const scaleT = (ms: number) => segB.from + 12 + (ms / 5447) * (tRec - segB.from - 6);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Stripes opacity={0.16} />
      <Glow opacity={0.1} />
      <Sequence from={segA.from} durationInFrames={segA.len + 8}>
        <Stage3D dur={segA.len} from={{ ry: -10, rx: 5, s: 1.0, z: -60 }} to={{ ry: -4, rx: 2, s: 1.06, z: 0 }}>
          <Win url="desk.skeinlabs.site/apply" live width={1600} height={900}>
            <Clip src="v2/clips/desk-live.mp4" start={0.8} rate={1.05} width={1600} height={900} />
          </Win>
        </Stage3D>
        <div style={{ position: "absolute", left: 120, top: 70 }}><Mono size={22} color={C.thread}>[ → ] Live · Skein Desk · Telegraph testnet · Nov 11, 2026</Mono></div>
      </Sequence>
      <Sequence from={segB.from} durationInFrames={segB.len + 8}>
        <AbsoluteFill style={{ padding: "110px 140px" }}>
          <Mono size={22} color={C.thread}>[ → ] The desk agent buys a verdict · Aerodrome (AERO) on Base</Mono>
          <div style={{ display: "flex", gap: 90, marginTop: 40, alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              {A.lines.map((l) => {
                const t = scaleT(l.ms) - segB.from;
                const f = frame - segB.from;
                const p = interpolate(f, [t - 2, t + 6], [0, 1], clamp);
                const pending = interpolate(f, [4, 12], [0, 1], clamp);
                return (
                  <div key={l.check} style={{ display: "grid", gridTemplateColumns: "270px 1fr 140px 260px", alignItems: "center", gap: 20, padding: "30px 0", borderBottom: `1px solid ${C.edge}`, opacity: pending }}>
                    <div style={{ fontFamily: F.display, fontSize: 42, color: C.text }}>{CHECK_NAME[l.check]}</div>
                    <div style={{ fontFamily: F.mono, fontSize: 22, color: C.muted }}>{l.miner}</div>
                    <div style={{ fontFamily: F.mono, fontSize: 26, color: C.knot, opacity: p }}>${l.amount.toFixed(3)}</div>
                    <div style={{ fontFamily: F.mono, fontSize: 23, color: p > 0.5 ? C.approve : C.muted }}>{p > 0.5 ? `✓ ${short(l.receipt)}` : "buying…"}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ width: 380 }}>
              {[
                ["Receipts", `${A.lines.filter((l) => frame >= scaleT(l.ms)).length}`, C.approve, tRec],
                ["Seconds", interpolate(frame, [segB.from + 12, tRec], [0, A.durationMs / 1000], clamp).toFixed(1), C.text, tSec],
                ["Intelligence", `$${(A.lines.filter((l) => frame >= scaleT(l.ms)).length * 0.01).toFixed(2)}`, C.knot, tCents],
              ].map(([label, v, col, t]) => {
                const hot = frame >= (t as number) && frame < (t as number) + 40;
                return (
                  <div key={label as string} style={{ marginBottom: 34, transform: `scale(${hot ? 1.06 : 1})`, transformOrigin: "left center" }}>
                    <Mono size={18} color={hot ? (col as string) : C.muted}>{label}</Mono>
                    <div style={{ fontFamily: F.display, fontWeight: 300, fontSize: 104, letterSpacing: "-0.05em", color: col as string, lineHeight: 1, textShadow: hot ? `0 0 40px ${col}` : undefined }}>{v}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </AbsoluteFill>
      </Sequence>
      <Sequence from={segC.from}>
        <Stage3D dur={s.dur - segC.from} from={{ ry: 8, rx: 4, s: 1.0 }} to={{ ry: 3, rx: 2, s: 1.05 }}>
          <Win url="desk.skeinlabs.site/a/app_mwcfytcf1igpve5" width={1600} height={900}>
            <Pic src="v2/shots/desk-app.png" dur={s.dur - segC.from} from={[1, 0.3, 0.1]} to={[1.12, 0.2, 0.25]} />
          </Win>
        </Stage3D>
        <AbsoluteFill style={{ alignItems: "flex-end", justifyContent: "flex-start", padding: "150px 110px 0 0" }}>
          <Stamp text="APPROVED · SHORTLISTED" delay={tApproved - segC.from} color={C.approve} size={78} />
        </AbsoluteFill>
      </Sequence>
      <Flash at={tApproved} color={C.approve} peak={0.18} />
      <Grain />
    </AbsoluteFill>
  );
};

/* 7 — Live, in the console: an address on the OFAC list is rejected outright. */
export const Sanction: React.FC = () => {
  const frame = useCurrentFrame();
  const s = scene("sanction");
  const R = data.reject, SDN = data.sdn;
  const tLaz = at("sanction", "Lazarus"), tChecks = at("sanction", "checks"), tMatch = at("sanction", "match"), tRej = at("sanction", "rejected"), tEv = at("sanction", "evidence");
  const segA = { from: 0, len: tChecks - 2 };
  const segB = { from: segA.len, len: tRej - 4 - segA.len };
  const segC = { from: tRej - 4 };
  // the scan: rows scroll past, the match locks at "match"
  const rows = [...SDN.rows.slice(SDN.targetIndex + 1), ...SDN.rows.slice(0, SDN.targetIndex + 1)];
  const scanP = interpolate(frame, [segB.from + 6, tMatch], [0, 1], { ...clamp, easing: easeInOut });
  const idx = Math.floor(scanP * (rows.length - 1));
  const locked = frame >= tMatch;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Glow color={C.reject} opacity={interpolate(frame, [0, 30], [0, 0.14], clamp)} />
      <Sequence from={segA.from} durationInFrames={segA.len + 8}>
        <Stage3D dur={segA.len} from={{ ry: 9, rx: 4, s: 1.0, z: -60 }} to={{ ry: 4, rx: 2, s: 1.06, z: 0 }}>
          <Win url="skeinlabs.site/console" live width={1600} height={900}>
            <Clip src="v2/clips/console-live.mp4" start={0.6} rate={1.0} width={1600} height={900} />
            <Callout x={270} y={502} w={310} h={48} delay={tLaz - 4} color={C.reject} label="Lazarus Group · OFAC SDN" side="top" />
          </Win>
        </Stage3D>
        <div style={{ position: "absolute", left: 120, top: 70 }}><Mono size={22} color={C.reject}>[ → ] Live · Skein console · Telegraph testnet · Nov 11, 2026</Mono></div>
      </Sequence>
      <Sequence from={segB.from} durationInFrames={segB.len + 8}>
        <AbsoluteFill style={{ padding: "100px 140px", display: "flex", flexDirection: "row", gap: 70 }}>
          <div style={{ flex: 1.1 }}>
            <Mono size={22} color={C.reject}>[ → ] US Treasury · OFAC SDN list · {SDN.count} EVM addresses · snapshot {SDN.fetched}</Mono>
            <div style={{ marginTop: 26, height: 720, overflow: "hidden", position: "relative", border: `1px solid ${C.edge}`, background: "rgba(11,13,15,0.9)" }}>
              <div style={{ position: "absolute", left: 0, right: 0, top: 330 - Math.min(idx, rows.length - 1) * 52, transition: "none" }}>
                {rows.map((r, i) => {
                  const hit = i === rows.length - 1 && locked;
                  const passed = i < idx;
                  return (
                    <div key={r.a} style={{ height: 52, display: "grid", gridTemplateColumns: "1fr 330px 90px", alignItems: "center", padding: "0 22px", fontFamily: F.mono, fontSize: 22, color: hit ? "#fff" : passed ? "#4b5560" : C.muted, background: hit ? "rgba(255,93,93,0.35)" : i === idx ? "rgba(255,255,255,0.06)" : undefined, borderLeft: hit ? `5px solid ${C.reject}` : "5px solid transparent" }}>
                      <span>{r.a}</span><span style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{r.n}</span><span style={{ color: hit ? C.reject : C.edge }}>{hit ? "MATCH" : "·"}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ position: "absolute", left: 0, right: 0, top: 330, height: 52, border: `2px solid ${locked ? C.reject : C.thread}`, boxShadow: `0 0 30px ${locked ? C.reject : C.thread}66`, pointerEvents: "none" }} />
            </div>
          </div>
          <div style={{ width: 520, paddingTop: 70 }}>
            <Mono size={18}>Subject</Mono>
            <div style={{ fontFamily: F.mono, fontSize: 24, color: C.text, marginTop: 8, wordBreak: "break-all" }}>{R.token}</div>
            <div style={{ marginTop: 40, opacity: locked ? 1 : 0.15 }}>
              <Glitch delay={tMatch} len={10}>
                <div style={{ fontFamily: F.display, fontWeight: 400, fontSize: 116, letterSpacing: "-0.05em", color: C.reject, lineHeight: 1 }}>Exact match.</div>
              </Glitch>
              <div style={{ fontFamily: F.mono, fontSize: 22, color: C.text, marginTop: 20, lineHeight: 1.6 }}>LAZARUS GROUP<br />SDN uid 27307 · ETH</div>
            </div>
          </div>
        </AbsoluteFill>
      </Sequence>
      <Sequence from={segC.from}>
        <Shake hits={[tRej - segC.from]} amp={12}>
          <Stage3D dur={s.dur - segC.from} from={{ ry: -7, s: 0.98 }} to={{ ry: -3, s: 1.02 }}>
            <Win url={`skeinlabs.site/v/${R.id}`} width={1600} height={900}>
              <Pic src="v2/shots/verdict-reject.png" dur={s.dur - segC.from} from={[1, 0, 0]} to={[1, 0, 0]} />
              <Callout x={348} y={622} w={186} h={122} delay={tRej - segC.from + 6} color={C.reject} label="confidence 100%" side="top" />
            </Win>
          </Stage3D>
          <div style={{ position: "absolute", right: 110, bottom: 140, width: 640, opacity: useSpring(tEv - segC.from - 2), transform: `translateY(${(1 - useSpring(tEv - segC.from - 2)) * 40}px)`, background: "rgba(11,13,15,0.97)", border: `1px solid ${C.reject}`, boxShadow: `0 0 60px rgba(255,93,93,0.3)`, padding: "20px 24px", fontFamily: F.mono, fontSize: 19, lineHeight: 1.65, color: "#c9d3d9" }}>
            <div style={{ color: C.reject, letterSpacing: "0.08em" }}>FINDING · SANCTIONS · FAIL · CONFIDENCE 1.00</div>
            <div>source&nbsp;&nbsp;<span style={{ color: C.text }}>{R.source}</span></div>
            <div>list&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: C.text }}>{R.evidence.list}</span></div>
            <div>sdnUid&nbsp;&nbsp;<span style={{ color: C.knot }}>{R.evidence.matches[0]!.sdnUid}</span></div>
            <div>sha256&nbsp;&nbsp;<span style={{ color: C.text }}>{short(R.evidence.listSha256, 10, 8)}</span></div>
          </div>
        </Shake>
      </Sequence>
      <Flash at={tMatch} color={C.reject} peak={0.3} />
      <Flash at={tRej} color={C.reject} peak={0.25} />
      <Grain />
    </AbsoluteFill>
  );
};

/* 8 — The bill of materials: every purchase, one Merkle root, one signature. */
export const Bom: React.FC = () => {
  const frame = useCurrentFrame();
  const s = scene("bom");
  const cols = [
    ["Miner", at("bom", "minor")],
    ["Cost", at("bom", "cost")],
    ["Receipt", at("bom", "receipt")],
    ["Signal", at("bom", "signal")],
  ] as const;
  const tRoot = at("bom", "Merkel"), tSigned = at("bom", "signed");
  const lift = interpolate(frame, [tRoot - 14, tRoot + 4], [0, 1], { ...clamp, easing: easeInOut });
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Dust n={30} opacity={0.4} seed="bom" />
      <AbsoluteFill style={{ padding: "90px 120px" }}>
        <Mono size={22} color={C.thread}>[ → ] Bill of materials · {A.id}</Mono>
        <div style={{ marginTop: 26, transform: `translateY(${-lift * 70}px) scale(${1 - lift * 0.18})`, transformOrigin: "top left", opacity: 1 - lift * 0.35 }}>
          <div style={{ display: "grid", gridTemplateColumns: "250px 470px 150px 1fr 1fr", gap: 18, padding: "14px 0", borderBottom: `1px solid ${C.edge}` }}>
            {["Check", ...cols.map((c) => c[0])].map((h, i) => {
              const hot = i > 0 && frame >= cols[i - 1]![1] - 2;
              return <Mono key={h} size={18} color={hot ? C.thread : C.muted}>{h}</Mono>;
            })}
          </div>
          {A.lines.map((l, r) => {
            const p = useSpring(4 + r * 4, { damping: 16 });
            const show = (i: number) => frame >= cols[i]![1] - 2;
            return (
              <div key={l.check} style={{ display: "grid", gridTemplateColumns: "250px 470px 150px 1fr 1fr", gap: 18, padding: "26px 0", borderBottom: `1px solid ${C.edge}`, alignItems: "center", opacity: p, transform: `translateX(${(1 - p) * 60}px)` }}>
                <div style={{ fontFamily: F.display, fontSize: 38, color: C.text }}>{CHECK_NAME[l.check]}</div>
                <div style={{ fontFamily: F.mono, fontSize: 23, color: show(0) ? C.text : "transparent" }}>{l.miner}</div>
                <div style={{ fontFamily: F.mono, fontSize: 24, color: show(1) ? C.knot : "transparent" }}>${l.amount.toFixed(3)}</div>
                <div style={{ fontFamily: F.mono, fontSize: 22, color: show(2) ? C.approve : "transparent" }}>{short(l.receipt, 10, 6)}</div>
                <div style={{ fontFamily: F.mono, fontSize: 22, color: show(3) ? C.thread : "transparent" }}>{short(l.signal, 12, 6)}</div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
      {/* the Merkle tree */}
      <svg width="1920" height="1080" style={{ position: "absolute", opacity: lift }}>
        {(() => {
          const leaves = A.lines.map((_, i) => [460 + i * 250, 900]);
          const l2 = [[585, 780], [1085, 780], [1460, 780]];
          const l3 = [[835, 680], [1460, 680]];
          const root = [1147, 580];
          const edge = (a: number[], b: number[], t: number, k: string) => {
            const p = interpolate(frame - t, [0, 10], [0, 1], clamp);
            return <line key={k} x1={a[0]} y1={a[1]} x2={a[0]! + (b[0]! - a[0]!) * p} y2={a[1]! + (b[1]! - a[1]!) * p} stroke={C.thread} strokeWidth={2.5} />;
          };
          const t0 = tRoot - 10;
          return (
            <>
              {leaves.map((lf, i) => edge(lf, l2[Math.min(2, Math.floor(i / 2))]!, t0, `e1${i}`))}
              {edge(l2[0]!, l3[0]!, t0 + 6, "e20")}{edge(l2[1]!, l3[0]!, t0 + 6, "e21")}{edge(l2[2]!, l3[1]!, t0 + 6, "e22")}
              {edge(l3[0]!, root, t0 + 12, "e30")}{edge(l3[1]!, root, t0 + 12, "e31")}
              {[...leaves, ...l2, ...l3].map((n, i) => <rect key={`n${i}`} x={n[0]! - 9} y={n[1]! - 9} width={18} height={18} fill={i < 5 ? C.approve : C.thread} />)}
              <circle cx={root[0]} cy={root[1]} r={interpolate(frame - t0 - 18, [0, 8], [0, 22], clamp)} fill={C.knot} style={{ filter: `drop-shadow(0 0 20px ${C.knot})` }} />
            </>
          );
        })()}
      </svg>
      <div style={{ position: "absolute", left: 1190, top: 520, opacity: interpolate(frame, [tRoot + 8, tRoot + 16], [0, 1], clamp) }}>
        <Mono size={18} color={C.knot}>Merkle root</Mono>
        <div style={{ fontFamily: F.mono, fontSize: 26, color: C.text }}>{short(A.bomRoot, 14, 8)}</div>
      </div>
      <div style={{ position: "absolute", left: 120, top: 620, opacity: frame >= tSigned - 3 ? 1 : 0 }}>
        <Stamp text="SIGNED · EIP-191" delay={tSigned - 3} color={C.thread} size={64} rotate={-4} />
        <div style={{ marginTop: 18 }}><Mono size={18}>attester {short(A.attester ?? "0x", 8, 6)}</Mono></div>
      </div>
      <Flash at={tRoot + 18} color={C.knot} peak={0.15} />
      <Grain />
    </AbsoluteFill>
  );
};

/* 9 — Verify: replay the verdict from the raw answers; every step matches. */
const STEPS = [
  ["Answers re-read", "each paid answer re-read by the adapter version that read it", "answers"],
  ["Policy rerun", "same decision, same verdict hash", "policy"],
  ["Receipts re-rooted", "the Merkle root rebuilt from every receipt", "receipts"],
  ["Engine matched", "the engine version that sealed the verdict", "engine"],
  ["Signature checked", "recovers to the published attester", "signature"],
] as const;
export const Verify: React.FC = () => {
  const frame = useCurrentFrame();
  const s = scene("verify");
  const tPaste = at("verify", "Paste"), tSteps = at("verify", "answers", { nth: 1 }), tAll = at("verify", "Every");
  const showPage = frame < tSteps - 6;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Glow opacity={0.08} />
      {showPage && (
        <Stage3D dur={tSteps} from={{ ry: -9, rx: 4, s: 1.0 }} to={{ ry: -3, rx: 2, s: 1.06 }}>
          <Win url="skeinlabs.site/verify" width={1600} height={900}>
            <Pic src="v2/shots/web-verify.png" dur={tSteps} from={[1, 0, 0]} to={[1, 0, 0]} />
            <div style={{ position: "absolute", left: 146, top: 512, width: 560, height: 36, background: "#0b0d0f", display: "flex", alignItems: "center", padding: "0 12px", fontFamily: F.mono, fontSize: 17, color: C.text }}>
              <Type text={A.id} delay={tPaste} cps={30} />
            </div>
          </Win>
        </Stage3D>
      )}
      {!showPage && (
        <AbsoluteFill style={{ padding: "120px 200px" }}>
          <Mono size={22} color={C.thread}>[ → ] skeinlabs.site/verify · {A.id}</Mono>
          <div style={{ marginTop: 40 }}>
            {STEPS.map(([h, sub, cue], i) => {
              const t = at("verify", cue, { nth: cue === "answers" ? 1 : 0 });
              const p = interpolate(frame - (t - 3), [0, 12], [0, 1], { ...clamp, easing: ease });
              const ok = frame >= t + 2;
              return (
                <div key={h} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 0", borderBottom: `1px solid ${C.edge}`, opacity: 0.25 + 0.75 * p, transform: `translateX(${(1 - p) * 40}px)` }}>
                  <div>
                    <div style={{ fontFamily: F.display, fontSize: 52, letterSpacing: "-0.03em", color: C.text }}>{h}</div>
                    <div style={{ fontFamily: F.mono, fontSize: 18, color: C.muted, marginTop: 4 }}>{sub}</div>
                  </div>
                  <div style={{ width: 64, height: 64, border: `2px solid ${ok ? C.approve : C.edge}`, background: ok ? "rgba(61,220,132,0.15)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, color: C.approve, transform: `scale(${ok ? interpolate(frame - t - 2, [0, 6], [1.4, 1], clamp) : 1})`, boxShadow: ok ? `0 0 26px ${C.approve}66` : undefined }}>{ok ? "✓" : ""}</div>
                </div>
              );
            })}
          </div>
        </AbsoluteFill>
      )}
      {frame >= tAll - 2 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", background: `rgba(0,0,0,${interpolate(frame, [tAll - 2, tAll + 8], [0, 0.82], clamp)})` }}>
          <Words text="Every step matches." delay={tAll - 2} size={150} align="center" accent={["matches"]} accentColor={C.approve} />
        </AbsoluteFill>
      )}
      <Flash at={tAll} color={C.approve} peak={0.15} />
      <Grain />
    </AbsoluteFill>
  );
};
