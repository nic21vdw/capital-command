import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { ColdOpenHook } from "./scenes/ColdOpenHook";
import { ThenVsNow } from "./scenes/ThenVsNow";
import { StepOne } from "./scenes/StepOne";
import { ModelPicker } from "./scenes/ModelPicker";
import { EndCard } from "./scenes/EndCard";
import { theme } from "./theme";

/**
 * Continuous 25s (750-frame @ 30fps) assembly, back to back. The whole short
 * is the hook/intro for the series: the big claim, the historical parallel
 * that earns it, then the single actionable step — pick the right model.
 *
 * Scene map (frames):
 *   ColdOpenHook    0 – 90    (3s)  "AI is the new industrial revolution"
 *   ThenVsNow      90 – 270   (6s)  1800s steam vs today's AI — same shift
 *   StepOne       270 – 420   (5s)  STEP 1 → choose the right model
 *   ModelPicker   420 – 630   (7s)  match the model to the job, 3 rows
 *   EndCard       630 – 750   (4s)  step 1 of the series → next: put it to work
 */
export const TOTAL_FRAMES = 750;

export const Video: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <Sequence from={0} durationInFrames={90}>
        <ColdOpenHook />
      </Sequence>
      <Sequence from={90} durationInFrames={180}>
        <ThenVsNow />
      </Sequence>
      <Sequence from={270} durationInFrames={150}>
        <StepOne />
      </Sequence>
      <Sequence from={420} durationInFrames={210}>
        <ModelPicker />
      </Sequence>
      <Sequence from={630} durationInFrames={120}>
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  );
};
