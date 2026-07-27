import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { ColdOpenTitle } from "./scenes/ColdOpenTitle";
import { TierList } from "./scenes/TierList";
import { TheMove } from "./scenes/TheMove";
import { ByTheWay } from "./scenes/ByTheWay";
import { EndCard } from "./scenes/EndCard";
import { theme } from "./theme";

/**
 * Continuous 22s (660-frame @ 30fps) assembly, back to back. The whole short
 * is the "explain it in the simplest terms" format: a quick promise, the
 * tier list, then two one-word payoff beats and a series hook.
 *
 * Scene map (frames):
 *   ColdOpenTitle   0 – 90    (3s)  "how to start vibe coding, simplest terms"
 *   TierList       90 – 300   (7s)  Gemini BAD · ChatGPT OKAY · Claude GOOD
 *   TheMove       300 – 420   (4s)  "Buy the $20 account" → GOOD
 *   ByTheWay      420 – 540   (4s)  "you don't need to code" → GOOD
 *   EndCard       540 – 660   (4s)  step 1 of the series → next: first prompt
 */
export const TOTAL_FRAMES = 660;

export const Video: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <Sequence from={0} durationInFrames={90}>
        <ColdOpenTitle />
      </Sequence>
      <Sequence from={90} durationInFrames={210}>
        <TierList />
      </Sequence>
      <Sequence from={300} durationInFrames={120}>
        <TheMove />
      </Sequence>
      <Sequence from={420} durationInFrames={120}>
        <ByTheWay />
      </Sequence>
      <Sequence from={540} durationInFrames={120}>
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  );
};
