import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { ColdOpenTitle } from "./scenes/ColdOpenTitle";
import { Tagline } from "./scenes/Tagline";
import { HostCard } from "./scenes/HostCard";
import { ValueProps } from "./scenes/ValueProps";
import { CommentCTA } from "./scenes/CommentCTA";
import { EndCard } from "./scenes/EndCard";
import { theme } from "./theme";

/**
 * Continuous 23s (690-frame @ 30fps) assembly of all scenes, back to back.
 * Timeline is intentionally gapless so it renders to a single self-contained
 * clip for the PowerPoint slide (no live footage to composite here).
 *
 * Scene map (frames):
 *   ColdOpenTitle   0 – 90    (3s)
 *   Tagline        90 – 210   (4s)
 *   HostCard      210 – 330   (4s)
 *   ValueProps    330 – 480   (5s)
 *   CommentCTA    480 – 600   (4s)
 *   EndCard       600 – 690   (3s)
 */
export const TOTAL_FRAMES = 690;

export const Video: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <Sequence from={0} durationInFrames={90}>
        <ColdOpenTitle />
      </Sequence>
      <Sequence from={90} durationInFrames={120}>
        <Tagline />
      </Sequence>
      <Sequence from={210} durationInFrames={120}>
        <HostCard durationInFrames={120} />
      </Sequence>
      <Sequence from={330} durationInFrames={150}>
        <ValueProps />
      </Sequence>
      <Sequence from={480} durationInFrames={120}>
        <CommentCTA />
      </Sequence>
      <Sequence from={600} durationInFrames={90}>
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  );
};
