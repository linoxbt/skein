# Skein motion demo

The 3 min 13 s narrated demo film at `docs/demo/skein-motion.mp4`, built with
[Remotion](https://www.remotion.dev) (React → video). Every product screen in
it is a capture of the live services. The Desk scene is a real application
that bought a real verdict through Telegraph testnet while it was recorded:
`vrd_mw8dfz384v6a6v094n03`, APPROVE for AERO on Base, sealed in 5.8 s.

## Rebuild

```sh
cd video
npm install
node scripts/voice.mjs        # narration: Kokoro-82M, voice af_heart → public/vo
node capture/shots.cjs        # 2x screenshots of every page → public/shots (then convert to .jpg)
node capture/live.cjs         # live Desk run as screencast frames (buys one verdict)
python3 capture/clip.py       # frames → public/clips/desk-live.mp4; copy capture/live.json to src/live.json
sh scripts/fetch-audio.sh     # music and SFX from Mixkit, normalized; voice loudness-matched
npx remotion render Main out/skein-demo.mp4
```

`src/timeline.ts` lays the scenes out from the measured narration lengths.
`said()` places animations and sound effects on the words they illustrate.
`src/Main.tsx` holds the mix: the voice; a music bed that ducks under it;
the cold-open bed; and about 90 timed effects.

## Credits

- **Narration:** [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache 2.0),
  voice `af_heart`, run locally through `kokoro-js`.
- **Music** ("Moon Walk") and **sound effects:** [Mixkit](https://mixkit.co/license/),
  free for use in videos. The files are not redistributed here;
  `scripts/fetch-audio.sh` downloads them.
- **Type:** Inter Tight, Space Grotesk and JetBrains Mono (SIL OFL), the same
  files the site serves.
- **Brand:** the Skein mark, colors and layout language from `packages/ui`.
