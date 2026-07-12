import React from "react";
import { Composition } from "remotion";
import { Video, TOTAL_FRAMES } from "./Video";

/**
 * 1080x1920 vertical, 30fps. Duration = TOTAL_FRAMES (660 = 22s).
 * Composition id "VibeCodingFirstSteps" is what `remotion render` targets.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="VibeCodingFirstSteps"
      component={Video}
      durationInFrames={TOTAL_FRAMES}
      fps={30}
      width={1080}
      height={1920}
    />
  );
};
