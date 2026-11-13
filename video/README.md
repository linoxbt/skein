# Skein motion demo

The 3 min 48 s narrated demo film at `docs/demo/skein-motion.mp4` and the 42 s teaser at `docs/demo/skein-teaser.mp4`, built with
[Remotion](https://www.remotion.dev) (React → video). The composition is
`Film` (`src/v2`). The first cut, `Main` (`src/scenes`), is kept for
reference. `docs/demo/README.md` lists what is live footage and what is
real data.

## Rebuild

```sh
cd video
npm install
node capture/v2-shots.cjs                      # every page at 2x → public/v2/shots
KEY=sk_part_… node capture/v2-live.cjs console # live sanctions catch (buys one verdict)
node capture/v2-live.cjs desk                  # live Desk application (buys one verdict)
node capture/v2-verdicts.cjs                   # those verdicts' pages, tabs and /verify
python3 capture/v2-clip.py console && python3 capture/v2-clip.py desk   # frames → clips
node scripts/voice-v2.mjs                      # narration: Kokoro-82M af_heart → public/v2/vo
python3 -I scripts/align-v2.py                 # word timings → public/v2/vo/words.json
sh scripts/fetch-audio-v2.sh                   # Mixkit music and effects, peak-normalized
npx remotion render Film out/film-v2-raw.mp4
npx remotion render Teaser out/teaser-raw.mp4  # the 42 s teaser (src/teaser); music: public/v2/music/teaser-edit.wav
```

Then master the audio to −14 LUFS (two-pass `loudnorm`) and encode two-pass
H.264 at about 3.4 Mb/s for the repository copy.

How the film is put together:
- **`src/v2/tl.ts`** lays the scenes out from the narration's measured
  lengths. Its `at(scene, word)` returns the frame a word is spoken, from the
  aligned timings, and fails loudly if the word is missing.
- **`src/v2/Film.tsx`** holds the mix:
  - the narration;
  - the music, ducked under the voice;
  - every effect, placed by its measured peak (`public/v2/sfx-meta.json`).

## Credits

- **Narration:** [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache 2.0),
  voice `af_heart`, run locally through `kokoro-js`. Timings come from
  [faster-whisper](https://github.com/SYSTRAN/faster-whisper).
- **Music:** "We Will Get It" by Eugenio Mininni, and the sound effects, from
  [Mixkit](https://mixkit.co/license/), free for use in videos. The files are
  not redistributed here; `scripts/fetch-audio-v2.sh` downloads them.
- **Type:** Inter Tight, Space Grotesk and JetBrains Mono (SIL OFL), the same
  files the site serves.
- **Brand:** the Skein mark, colours and layout language from `packages/ui`.
