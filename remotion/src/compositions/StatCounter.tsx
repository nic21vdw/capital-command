import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { z } from "zod";
import { FONT_STACK, THEMES, themeSchema } from "../theme";

export const statCounterSchema = z.object({
  label: z.string(),
  value: z.number(),
  prefix: z.string(),
  suffix: z.string(),
  decimals: z.number().min(0).max(4),
  theme: themeSchema,
  // Total length of the segment (seconds × 30). Controls render duration.
  durationInFrames: z.number().min(15).max(1800),
});

export type StatCounterProps = z.infer<typeof statCounterSchema>;

// A big number that counts up. Great for "$1,240 MRR" or "97% retention"
// beats you want to land while talking.
export const StatCounter: React.FC<StatCounterProps> = ({
  label,
  value,
  prefix,
  suffix,
  decimals,
  theme,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = THEMES[theme];

  const progress = spring({ frame, fps, config: { damping: 200, mass: 1.4 } });
  const current = interpolate(progress, [0, 1], [0, value]);
  const display = current.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  const labelIn = interpolate(frame, [10, 26], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: t.bg,
        fontFamily: FONT_STACK,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          fontSize: 220,
          fontWeight: 800,
          color: t.accent,
          letterSpacing: -6,
          transform: `scale(${interpolate(progress, [0, 1], [0.9, 1])})`,
        }}
      >
        {prefix}
        {display}
        {suffix}
      </div>
      <div
        style={{
          opacity: labelIn,
          fontSize: 48,
          fontWeight: 500,
          color: t.sub,
          marginTop: 24,
        }}
      >
        {label}
      </div>
    </AbsoluteFill>
  );
};
