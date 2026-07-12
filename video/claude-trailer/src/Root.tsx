import React from "react";
import { Composition } from "remotion";
import { Video, TOTAL_FRAMES } from "./Video";
import { VIDEO } from "./theme";

/**
 * 1920x1080 (16:9), 30fps. Duration = TOTAL_FRAMES (600 = 20s).
 * Composition id "ClaudeTrailer" is what `remotion render` targets.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ClaudeTrailer"
      component={Video}
      durationInFrames={TOTAL_FRAMES}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
  );
};
