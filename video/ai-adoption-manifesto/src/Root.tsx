import React from "react";
import { Composition } from "remotion";
import { VIDEO } from "./config";
import { SLIDES } from "./slides/registry";
import { FullVideo, FULL_VIDEO_DURATION } from "./FullVideo";

/**
 * RemotionRoot — registers every slide as its own independent Composition
 * (so you can render each one separately for a narrated PowerPoint), plus a
 * `FullVideo` composition that stitches them together with cross-dissolves.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* One composition per slide — render individually for PowerPoint. */}
      {SLIDES.map((slide) => (
        <Composition
          key={slide.id}
          id={slide.id}
          component={slide.component}
          durationInFrames={slide.durationInFrames}
          fps={VIDEO.fps}
          width={VIDEO.width}
          height={VIDEO.height}
        />
      ))}

      {/* The full stitched manifesto. */}
      <Composition
        id="FullVideo"
        component={FullVideo}
        durationInFrames={FULL_VIDEO_DURATION}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />
    </>
  );
};
