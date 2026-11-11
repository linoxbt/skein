import React from "react";
import { Composition } from "remotion";
import { Main } from "./Main";
import { FPS, H, W } from "./theme";
import { TOTAL } from "./timeline";
import { Film, FILM_FRAMES } from "./v2/Film";
import { Teaser, TEASER_FRAMES } from "./teaser/Teaser";

export const Root: React.FC = () => (
  <>
    <Composition id="Main" component={Main} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
    <Composition id="Film" component={Film} durationInFrames={FILM_FRAMES} fps={FPS} width={W} height={H} />
    <Composition id="Teaser" component={Teaser} durationInFrames={TEASER_FRAMES} fps={FPS} width={W} height={H} />
  </>
);
