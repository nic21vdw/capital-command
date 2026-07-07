import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  interpolate,
} from "remotion";
import { COLORS, TRANSITION_FRAMES } from "./config";
import { SLIDES } from "./slides/registry";

/**
 * FadeWrap — fades its child in over the first `fade` frames and out over the
 * last `fade` frames, giving each slide a clean cross-dissolve when the
 * Sequences overlap.
 */
const FadeWrap: React.FC<{
  durationInFrames: number;
  fade: number;
  children: React.ReactNode;
}> = ({ durationInFrames, fade, children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, fade, durationInFrames - fade, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

/**
 * FullVideo — stitches all 14 slides into one continuous manifesto with
 * overlapping cross-dissolves. Rendered as the `FullVideo` composition.
 *
 * If you'd rather narrate slide-by-slide in PowerPoint, render each slide
 * composition individually instead (see the README / render:all script).
 */
export const FullVideo: React.FC = () => {
  let cursor = 0;
  return (
    <AbsoluteFill style={{ background: COLORS.background }}>
      {SLIDES.map((slide, i) => {
        const from = i === 0 ? 0 : cursor - TRANSITION_FRAMES;
        cursor = from + slide.durationInFrames;
        const Comp = slide.component;
        return (
          <Sequence
            key={slide.id}
            from={from}
            durationInFrames={slide.durationInFrames}
            name={slide.id}
          >
            <FadeWrap
              durationInFrames={slide.durationInFrames}
              fade={TRANSITION_FRAMES}
            >
              <Comp />
            </FadeWrap>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

/** Total frame length of the stitched video (accounts for overlaps). */
export const FULL_VIDEO_DURATION = SLIDES.reduce(
  (acc, s, i) => acc + s.durationInFrames - (i === 0 ? 0 : TRANSITION_FRAMES),
  0,
);
