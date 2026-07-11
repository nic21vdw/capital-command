import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { COLOR_BG } from "./theme";
import { TimelineScene } from "./scenes/TimelineScene";
import { PriceWarScene } from "./scenes/PriceWarScene";
import { PlayersScene } from "./scenes/PlayersScene";

/**
 * Timeline for the "AI Price War" B-roll block (~20s @ 30fps).
 *
 * These are INSERT graphics for a mostly direct-to-camera news video — in the
 * real edit each scene gets dropped onto its own point in the timeline. The
 * `from` values below just play the three scenes back-to-back so the full
 * block previews in one pass. Each scene file carries a comment with its
 * intended VO timing.
 */
export const TIMELINE = {
  timeline: { from: 0, durationInFrames: 150 }, // 0:00–0:05 · 48-hour news cards
  priceWar: { from: 150, durationInFrames: 210 }, // 0:05–0:12 · $2 vs $10 fracture
  players: { from: 360, durationInFrames: 240 } // 0:12–0:20 · triangle + Grok reveal
} as const;

export const TOTAL_FRAMES = 600;

export const Video: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: COLOR_BG }}>
      <Sequence name="TimelineScene" {...TIMELINE.timeline}>
        <TimelineScene />
      </Sequence>

      <Sequence name="PriceWarScene" {...TIMELINE.priceWar}>
        <PriceWarScene />
      </Sequence>

      <Sequence name="PlayersScene" {...TIMELINE.players}>
        <PlayersScene />
      </Sequence>
    </AbsoluteFill>
  );
};
