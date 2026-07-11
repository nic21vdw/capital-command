import React from "react";
import { Composition } from "remotion";
import { VIDEO } from "./theme";
import { Video, TOTAL_FRAMES, TIMELINE } from "./Video";
import { TimelineScene } from "./scenes/TimelineScene";
import { PriceWarScene } from "./scenes/PriceWarScene";
import { PlayersScene } from "./scenes/PlayersScene";

/**
 * Registers the full 20s B-roll block PLUS each scene as its own composition,
 * so individual inserts can be rendered separately for compositing.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="AIPriceWar"
        component={Video}
        durationInFrames={TOTAL_FRAMES}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />

      {/* ---- Individual scenes (render standalone) ---- */}
      <Composition
        id="TimelineScene"
        component={TimelineScene}
        durationInFrames={TIMELINE.timeline.durationInFrames}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />
      <Composition
        id="PriceWarScene"
        component={PriceWarScene}
        durationInFrames={TIMELINE.priceWar.durationInFrames}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />
      <Composition
        id="PlayersScene"
        component={PlayersScene}
        durationInFrames={TIMELINE.players.durationInFrames}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />
    </>
  );
};
