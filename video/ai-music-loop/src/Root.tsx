import React from "react";
import { Composition } from "remotion";
import { Video } from "./Video";
import { FPS, TOTAL_FRAMES } from "./theme";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="AiMusicLoop"
      component={Video}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
    />
  );
};
