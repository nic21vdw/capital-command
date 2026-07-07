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
import { BrandDecor, ClaudeSpark, CLAUDE_CORAL } from "../brand";

export const titleCardSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  theme: themeSchema,
  // Total length of the segment (seconds × 30). Controls render duration.
  durationInFrames: z.number().min(15).max(1800),
});

export type TitleCardProps = z.infer<typeof titleCardSchema>;

// Animated opener: accent bar wipes in, title springs up, subtitle fades.
export const TitleCard: React.FC<TitleCardProps> = ({ title, subtitle, theme }) => {
  // durationInFrames is consumed by calculateMetadata in Root, not here.
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = THEMES[theme];

  const titleRise = spring({ frame, fps, config: { damping: 200 } });
  const titleY = interpolate(titleRise, [0, 1], [40, 0]);

  const barWidth = interpolate(frame, [0, 20], [0, 220], {
    extrapolateRight: "clamp",
  });
  const subOpacity = interpolate(frame, [18, 34], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: t.bg,
        fontFamily: FONT_STACK,
        justifyContent: "center",
        paddingLeft: 160,
        paddingRight: 160,
      }}
    >
      <BrandDecor />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          marginBottom: 48,
        }}
      >
        <div
          style={{
            height: 10,
            width: barWidth,
            borderRadius: 8,
            backgroundColor: t.accent,
          }}
        />
        <ClaudeSpark size={38} color={CLAUDE_CORAL} opacity={titleRise} />
      </div>
      <div
        style={{
          transform: `translateY(${titleY}px)`,
          opacity: titleRise,
          fontSize: 110,
          fontWeight: 800,
          lineHeight: 1.02,
          color: t.text,
          letterSpacing: -2,
        }}
      >
        {title}
      </div>
      <div
        style={{
          opacity: subOpacity,
          fontSize: 44,
          fontWeight: 500,
          color: t.sub,
          marginTop: 28,
        }}
      >
        {subtitle}
      </div>
    </AbsoluteFill>
  );
};
