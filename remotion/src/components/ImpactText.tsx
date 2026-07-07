import React from "react";
import { useCurrentFrame, spring, useVideoConfig, interpolate } from "remotion";
import { COLORS, FONT, glow } from "../config";
import { FONT_FAMILY } from "../fonts";

/**
 * ImpactText — headline that slams in with an overshoot scale and a short
 * shake on impact. Used for the hardest-hitting lines.
 */
export const ImpactText: React.FC<{
  children: string;
  startFrame?: number;
  color?: string;
  fontSize?: number;
}> = ({
  children,
  startFrame = 0,
  color = COLORS.accentAlt,
  fontSize = 140,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - startFrame;

  // Slam-in: fast overshoot then settle.
  const slam = spring({
    frame: local,
    fps,
    config: { damping: 9, mass: 0.6, stiffness: 140 },
  });
  const scale = interpolate(slam, [0, 1], [1.6, 1]);
  const opacity = interpolate(local, [0, 4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Shake decays over ~12 frames after impact.
  const shakeAmt = interpolate(local, [0, 12], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const shakeX = Math.sin(local * 4.3) * 10 * shakeAmt;
  const shakeY = Math.cos(local * 5.1) * 6 * shakeAmt;

  return (
    <div
      style={{
        transform: `translate(${shakeX}px, ${shakeY}px) scale(${scale})`,
        opacity,
      }}
    >
      <div
        style={{
          fontFamily: FONT_FAMILY,
          fontWeight: FONT.weightBlack,
          fontSize,
          color,
          textAlign: "center",
          letterSpacing: FONT.letterSpacingTight,
          lineHeight: 1.02,
          textTransform: "uppercase",
          whiteSpace: "pre-line",
          textShadow: glow(color, 1.3),
        }}
      >
        {children}
      </div>
    </div>
  );
};
