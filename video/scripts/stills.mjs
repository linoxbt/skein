import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
const frames = process.argv.slice(2).map(Number);
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const browserExecutable = "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell";
const composition = await selectComposition({ serveUrl, id: "Main", browserExecutable });
console.log("total frames", composition.durationInFrames);
for (const f of frames) {
  await renderStill({ composition, serveUrl, output: `out/still-${String(f).padStart(5, "0")}.jpg`, frame: f, imageFormat: "jpeg", jpegQuality: 80, scale: 0.5, browserExecutable });
  console.log("still", f);
}
