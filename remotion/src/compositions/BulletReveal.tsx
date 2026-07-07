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
import { BrandDecor } from "../brand";

export const bulletRevealSchema = z.object({
  heading: z.string(),
  bullets: z.array(z.string()),
  // Frames each bullet waits before the next appears (30fps => 30 = 1s).
  stagger: z.number().min(6).max(120),
  theme: themeSchema,
  // Total length of the segment (seconds × 30). Controls render duration.
  durationInFrames: z.number().min(15).max(1800),
});

export type BulletRevealProps = z.infer<typeof bulletRevealSchema>;

// The anti-slideshow: points slide + fade in one at a time so you can
// talk to each beat. Set `stagger` to match your speaking pace.
export const BulletReveal: React.FC<BulletRevealProps> = ({
  heading,
  bullets,
  stagger,
  theme,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = THEMES[theme];

  const headingIn = interpolate(frame, [0, 16], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: t.bg,
        fontFamily: FONT_STACK,
        justifyContent: "center",
        padding: "0 160px",
      }}
    >
      <BrandDecor />
      <div
        style={{
          opacity: headingIn,
          transform: `translateY(${interpolate(headingIn, [0, 1], [20, 0])}px)`,
          fontSize: 68,
          fontWeight: 800,
          color: t.text,
          marginBottom: 64,
          letterSpacing: -1,
        }}
      >
        {heading}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
        {bullets.map((bullet, i) => {
          const start = 18 + i * stagger;
          const enter = spring({
            frame: frame - start,
            fps,
            config: { damping: 200 },
          });
          const x = interpolate(enter, [0, 1], [-48, 0]);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 28,
                opacity: enter,
                transform: `translateX(${x}px)`,
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 6,
                  backgroundColor: t.accent,
                  flexShrink: 0,
                }}
              />
              <div style={{ fontSize: 48, fontWeight: 500, color: t.text }}>
                {bullet}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
