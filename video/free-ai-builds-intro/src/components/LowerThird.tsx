import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { theme, fontFamily } from "../theme";

/**
 * Reusable lower-third name/title card. Slides in from the left, holds, then
 * slides out near the end of its host Sequence. Pass `name`, `subtitle`, and
 * the total `durationInFrames` of the surrounding Sequence so it can time its
 * own exit. Reuse this in every future episode with different props.
 */
export const LowerThird: React.FC<{
  name: string;
  subtitle: string;
  durationInFrames: number;
}> = ({ name, subtitle, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 16 } });
  const exitStart = durationInFrames - 20;
  const exit = interpolate(frame, [exitStart, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const x = interpolate(enter, [0, 1], [-120, 0]) + interpolate(exit, [0, 1], [0, -140]);
  const opacity = interpolate(enter, [0, 1], [0, 1]) * (1 - exit);

  return (
    <div
      style={{
        position: "absolute",
        left: 90,
        bottom: 320,
        transform: `translateX(${x}px)`,
        opacity,
      }}
    >
      <div
        style={{
          width: 14,
          height: 128,
          backgroundColor: theme.accent,
          borderRadius: 8,
          position: "absolute",
          left: -30,
          top: 6,
        }}
      />
      <div
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize: 60,
          color: theme.text,
          lineHeight: 1.05,
        }}
      >
        {name}
      </div>
      <div
        style={{
          fontFamily,
          fontWeight: 600,
          fontSize: 34,
          color: theme.highlight,
          marginTop: 10,
        }}
      >
        {subtitle}
      </div>
    </div>
  );
};
