import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOR_SECONDARY, COLOR_TEXT, FONT_FAMILY, WEIGHT, withAlpha } from "../theme";

/**
 * Scene 4 · 4s (120f). "COMMENT BELOW" bounces in (spring overshoot) in the
 * yellow CTA accent, with a supporting off-white line. Both pulse subtly to
 * pull the eye without being obnoxious.
 */
export const CommentCTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Bouncy entrance (low damping -> overshoot).
  const pop = spring({ frame, fps, config: { damping: 9, mass: 0.9, stiffness: 130 } });
  const popScale = interpolate(pop, [0, 1], [0.4, 1]);

  const subIn = spring({ frame: frame - 10, fps, config: { damping: 18 } });

  // Subtle shared pulse (~0.9 Hz).
  const wave = (Math.sin((frame / fps) * Math.PI * 2 * 0.9) + 1) / 2;
  const pulseScale = interpolate(wave, [0, 1], [1, 1.035]);
  const glow = interpolate(wave, [0, 1], [10, 26]);
  const subOpacity = interpolate(wave, [0, 1], [0.82, 1]);

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", fontFamily: FONT_FAMILY }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 34 }}>
        <div
          style={{
            fontSize: 150,
            fontWeight: WEIGHT.black,
            color: COLOR_SECONDARY,
            letterSpacing: 1,
            lineHeight: 1.0,
            textAlign: "center",
            transform: `scale(${popScale * pulseScale})`,
            textShadow: `0 0 ${glow}px ${withAlpha(COLOR_SECONDARY, 0.55)}`
          }}
        >
          COMMENT
          <br />
          BELOW
        </div>
        <div
          style={{
            fontSize: 52,
            fontWeight: WEIGHT.semibold,
            color: COLOR_TEXT,
            opacity: Math.min(subIn, subOpacity),
            transform: `scale(${interpolate(subIn, [0, 1], [0.9, 1]) * pulseScale})`,
            textAlign: "center"
          }}
        >
          Tell me what you want built
        </div>
      </div>
    </AbsoluteFill>
  );
};
