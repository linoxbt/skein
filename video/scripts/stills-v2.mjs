// Renders review stills of the Film composition at given seconds (one bundle, many frames).
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
const secs = process.argv.slice(3).map(Number);
const out = process.argv[2];
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts"), publicDir: path.resolve("public") });
const browserExecutable = "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell";
const comp = await selectComposition({ serveUrl, id: "Film", browserExecutable });
for (const s of secs) {
  const frame = Math.min(comp.durationInFrames - 1, Math.round(s * 30));
  await renderStill({ serveUrl, composition: comp, frame, output: `${out}/f${String(frame).padStart(5, "0")}.jpg`, imageFormat: "jpeg", jpegQuality: 80, scale: 0.5, browserExecutable });
  console.log("still", s);
}
