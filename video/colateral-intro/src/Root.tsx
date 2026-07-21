import React from "react";
import { Composition } from "remotion";
import { IntroAssemble } from "./scenes/IntroAssemble";
import { IntroBeamSweep } from "./scenes/IntroBeamSweep";
import { VIDEO } from "./theme";

/**
 * Two CoLateral intro B-roll clips, 1920×1080 @ 30fps, 5s (150 frames) each.
 * Both reveal the "CoLateral" wordmark on white with the Beam Buddy mascot:
 *   IntroAssemble  — structural drop-in + beam underline (calm/premium)
 *   IntroBeamSweep — pop-in + light-beam wipe reveal (playful/energetic)
 */
export const RemotionRoot: React.FC = () => {
  const common = {
    durationInFrames: 150,
    fps: VIDEO.fps,
    width: VIDEO.width,
    height: VIDEO.height,
  } as const;

  return (
    <>
      <Composition id="IntroAssemble" component={IntroAssemble} {...common} />
      <Composition id="IntroBeamSweep" component={IntroBeamSweep} {...common} />
    </>
  );
};
