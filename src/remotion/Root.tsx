import React from "react";
import { Composition } from "remotion";
import { VIDEO } from "./theme";
import { TitleComp } from "./compositions/TitleComp";
import { HeadlineComp } from "./compositions/HeadlineComp";
import { ColumnVsBeamComp } from "./compositions/ColumnVsBeamComp";
import { BucklingComp } from "./compositions/BucklingComp";
import { CausesComp } from "./compositions/CausesComp";

/**
 * All five compositions for "Manhattan Column Buckling Explained".
 * Durations are explicit and in frames (30fps): 4s / 6s / 8s / 6s / 12s.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TitleComp"
        component={TitleComp}
        durationInFrames={4 * VIDEO.fps}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />
      <Composition
        id="HeadlineComp"
        component={HeadlineComp}
        durationInFrames={6 * VIDEO.fps}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />
      <Composition
        id="ColumnVsBeamComp"
        component={ColumnVsBeamComp}
        durationInFrames={8 * VIDEO.fps}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />
      <Composition
        id="BucklingComp"
        component={BucklingComp}
        durationInFrames={6 * VIDEO.fps}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />
      <Composition
        id="CausesComp"
        component={CausesComp}
        durationInFrames={12 * VIDEO.fps}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />
    </>
  );
};
