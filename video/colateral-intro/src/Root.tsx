import React from "react";
import { Composition } from "remotion";
import { IntroAssemble } from "./scenes/IntroAssemble";
import { IntroBeamSweep } from "./scenes/IntroBeamSweep";
import { IntroBlueprintBuild } from "./scenes/IntroBlueprintBuild";
import { IntroBeamGreeting } from "./scenes/IntroBeamGreeting";
import { IntroPixelType } from "./scenes/IntroPixelType";
import { VIDEO } from "./theme";

/**
 * CoLateral intro B-roll clips, 1920×1080 @ 30fps, 5s (150 frames) each.
 * All reveal the "CoLateral" wordmark on white — "Co" near-black, "Lateral"
 * brand blue — with the 8-bit Beam Buddy mascot (a structural I-beam in a hard
 * hat). Five iterations to pick from:
 *   IntroAssemble       — structural drop-in + beam underline (calm/premium)
 *   IntroBeamSweep      — pop-in + light-beam wipe reveal (playful/energetic)
 *   IntroBlueprintBuild — kicker + block-snap wordmark on a blueprint (layered)
 *   IntroBeamGreeting   — beam-sweep reveal + Buddy speech bubble (playful)
 *   IntroPixelType      — 8-bit type-on with blinking caret + scanlines (retro)
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
      <Composition id="IntroBlueprintBuild" component={IntroBlueprintBuild} {...common} />
      <Composition id="IntroBeamGreeting" component={IntroBeamGreeting} {...common} />
      <Composition id="IntroPixelType" component={IntroPixelType} {...common} />
    </>
  );
};
