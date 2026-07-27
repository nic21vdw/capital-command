import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { TierRow } from "../components/TierRow";
import { theme, fontFamily } from "../theme";

/**
 * The core beat. One tool per line, each on its own Sequence so the verdicts
 * land in rhythm: Gemini → BAD, ChatGPT → OKAY, Claude → GOOD. The rows stay
 * on screen once revealed (each Sequence runs to the end of the scene) so the
 * finished list reads as a tier list, not three separate cards.
 *
 * Row cadence (frames, relative to this scene): 0 / 55 / 110.
 */
const SCENE_FRAMES = 210;

export const TierList: React.FC = () => {
  return (
    <AbsoluteFill
      style={{ backgroundColor: theme.bg, justifyContent: "center", paddingLeft: 110 }}
    >
      <div
        style={{
          fontFamily,
          fontWeight: 700,
          fontSize: 46,
          color: theme.muted,
          letterSpacing: 2,
          marginBottom: 56,
        }}
      >
        WHICH AI DO YOU USE?
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 56 }}>
        <Sequence from={0} durationInFrames={SCENE_FRAMES} layout="none">
          <TierRow name="Gemini" verdict="BAD" tone="bad" />
        </Sequence>
        <Sequence from={55} durationInFrames={SCENE_FRAMES - 55} layout="none">
          <TierRow name="ChatGPT" verdict="OKAY" tone="okay" />
        </Sequence>
        <Sequence from={110} durationInFrames={SCENE_FRAMES - 110} layout="none">
          <TierRow name="Claude" verdict="GOOD" tone="good" />
        </Sequence>
      </div>
    </AbsoluteFill>
  );
};
