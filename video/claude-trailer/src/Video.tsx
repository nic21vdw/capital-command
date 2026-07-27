import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { LogoReveal } from "./scenes/LogoReveal";
import { HardestProblems } from "./scenes/HardestProblems";
import { Capabilities } from "./scenes/Capabilities";
import { Momentum } from "./scenes/Momentum";
import { EndCard } from "./scenes/EndCard";
import { theme } from "./theme";

/**
 * Continuous 20s (600-frame @ 30fps) trailer, paced as a bed for a voiceover
 * about Claude taking on the hardest work — sparse type, constant motion.
 *
 * Scene map (frames):
 *   LogoReveal        0 – 120   (4s)    spark spin-up + wordmark
 *   HardestProblems 120 – 260   (4.7s)  "BUILT FOR THE HARDEST PROBLEMS"
 *   Capabilities    260 – 420   (5.3s)  context / reasoning / agents cards
 *   Momentum        420 – 510   (3s)    "Think deeper. Ship faster." + comet
 *   EndCard         510 – 600   (3s)    spark + wordmark + claude.ai
 */
export const TOTAL_FRAMES = 600;

export const Video: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <Sequence from={0} durationInFrames={120}>
        <LogoReveal />
      </Sequence>
      <Sequence from={120} durationInFrames={140}>
        <HardestProblems />
      </Sequence>
      <Sequence from={260} durationInFrames={160}>
        <Capabilities />
      </Sequence>
      <Sequence from={420} durationInFrames={90}>
        <Momentum />
      </Sequence>
      <Sequence from={510} durationInFrames={90}>
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  );
};
