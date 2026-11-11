import durations from "../../public/v2/vo/durations.json";
import words from "../../public/v2/vo/words.json";
import script from "../../scripts/script-v2.json";
import { FPS } from "../theme";

/**
 * Film v2 timeline. Each scene is lead + narration + tail; cues come from the
 * narration's word timings (faster-whisper, public/v2/vo/words.json), so a
 * visual or a sound lands on the word itself, not on an estimate.
 */
const D = durations as Record<string, number>;
type Word = { w: string; s: number; e: number };
const W = words as Record<string, Word[]>;

export type SceneId = "cold" | "reveal" | "problem" | "how" | "decide" | "desk" | "sanction" | "bom" | "verify" | "sniper" | "bench" | "prod" | "integrate" | "outro";
const PLAN: { id: SceneId; vo: string; lead: number; tail: number }[] = [
  { id: "cold", vo: "v01", lead: 1.2, tail: 1.0 },
  { id: "reveal", vo: "v02", lead: 3.2, tail: 1.0 },
  { id: "problem", vo: "v03", lead: 0.6, tail: 0.8 },
  { id: "how", vo: "v04", lead: 0.7, tail: 1.0 },
  { id: "decide", vo: "v05", lead: 0.5, tail: 1.0 },
  { id: "desk", vo: "v06", lead: 1.0, tail: 1.3 },
  { id: "sanction", vo: "v07", lead: 1.0, tail: 1.3 },
  { id: "bom", vo: "v08", lead: 0.5, tail: 0.9 },
  { id: "verify", vo: "v09", lead: 0.5, tail: 1.0 },
  { id: "sniper", vo: "v10", lead: 0.6, tail: 1.0 },
  { id: "bench", vo: "v11", lead: 0.6, tail: 1.2 },
  { id: "prod", vo: "v12", lead: 0.5, tail: 0.6 },
  { id: "integrate", vo: "v13", lead: 0.5, tail: 1.0 },
  { id: "outro", vo: "v14", lead: 1.2, tail: 6.5 },
];

export type Scene = { id: SceneId; vo: string; from: number; dur: number; voFrom: number; voDur: number; text: string; words: Word[] };
const f = (s: number) => Math.round(s * FPS);
let cursor = 0;
export const SCENES: Scene[] = PLAN.map((p) => {
  const voDur = f(D[p.vo] ?? 5);
  const dur = f(p.lead) + voDur + f(p.tail);
  const text = (script as { id: string; text: string }[]).find((x) => x.id === p.vo)?.text ?? "";
  const s = { id: p.id, vo: p.vo, from: cursor, dur, voFrom: f(p.lead), voDur, text, words: W[p.vo] ?? [] };
  cursor += dur;
  return s;
});
export const TOTAL = cursor;
export const scene = (id: SceneId) => SCENES.find((s) => s.id === id)!;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/**
 * Frame (within the scene) at which a word is spoken. `word` may be several
 * words ("five cents"); `nth` picks a later occurrence; `edge` "e" gives the
 * end of the word. Throws if the word is not in the narration, so a script
 * change can never leave a cue silently misplaced.
 */
export function at(id: SceneId, word: string, opts: { nth?: number; edge?: "s" | "e"; offset?: number } = {}): number {
  const s = scene(id);
  const parts = word.split(/\s+/).map(norm);
  let seen = 0;
  for (let i = 0; i + parts.length <= s.words.length; i++) {
    if (parts.every((p, k) => norm(s.words[i + k]!.w).startsWith(p))) {
      if (seen++ === (opts.nth ?? 0)) {
        const t = opts.edge === "e" ? s.words[i + parts.length - 1]!.e : s.words[i]!.s;
        return s.voFrom + Math.round((t + (opts.offset ?? 0)) * FPS);
      }
    }
  }
  throw new Error(`cue "${word}" not found in ${id} (${s.vo})`);
}
/** Same, in film frames. */
export const atG = (id: SceneId, word: string, opts: { nth?: number; edge?: "s" | "e"; offset?: number } = {}) => scene(id).from + at(id, word, opts);
