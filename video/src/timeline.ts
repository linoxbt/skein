import durations from "../public/vo/durations.json";
import script from "../scripts/script.json";
import { FPS } from "./theme";

const D = durations as Record<string, number>;
export type SceneId = "cold" | "reveal" | "problem" | "how" | "verdict" | "live" | "evidence" | "verify" | "sniper" | "miner" | "bench" | "integrate" | "outro";
const PLAN: { id: SceneId; vo: string; lead: number; tail: number }[] = [
  { id: "cold", vo: "s01", lead: 1.8, tail: 0.5 },
  { id: "reveal", vo: "s02", lead: 1.9, tail: 1.5 },
  { id: "problem", vo: "s03", lead: 0.5, tail: 0.9 },
  { id: "how", vo: "s04", lead: 0.6, tail: 1.0 },
  { id: "verdict", vo: "s05", lead: 0.5, tail: 1.2 },
  { id: "live", vo: "s06", lead: 0.8, tail: 1.3 },
  { id: "evidence", vo: "s07", lead: 0.5, tail: 1.0 },
  { id: "verify", vo: "s08", lead: 0.5, tail: 1.3 },
  { id: "sniper", vo: "s09", lead: 0.6, tail: 1.2 },
  { id: "miner", vo: "s10", lead: 0.5, tail: 1.0 },
  { id: "bench", vo: "s11", lead: 0.5, tail: 1.2 },
  { id: "integrate", vo: "s12", lead: 0.5, tail: 1.2 },
  { id: "outro", vo: "s13", lead: 0.8, tail: 5.5 },
];
export type Scene = { id: SceneId; vo: string; from: number; dur: number; voFrom: number; voDur: number; text: string };
const f = (s: number) => Math.round(s * FPS);
let cursor = 0;
export const SCENES: Scene[] = PLAN.map((p) => {
  const voDur = f(D[p.vo] ?? 5);
  const dur = f(p.lead) + voDur + f(p.tail);
  const s = { id: p.id, vo: p.vo, from: cursor, dur, voFrom: f(p.lead), voDur, text: (script as { id: string; text: string }[]).find((x) => x.id === p.vo)?.text ?? "" };
  cursor += dur;
  return s;
});
export const TOTAL = cursor;
export const scene = (id: SceneId) => SCENES.find((s) => s.id === id)!;
/** Frame (within the scene) at which a phrase is spoken, estimated from its position in the line. */
export function said(id: SceneId, phrase: string, offset = 0): number {
  const s = scene(id);
  const i = s.text.toLowerCase().indexOf(phrase.toLowerCase());
  const ratio = i < 0 ? 0 : i / s.text.length;
  return Math.round(s.voFrom + ratio * s.voDur + offset * FPS);
}
