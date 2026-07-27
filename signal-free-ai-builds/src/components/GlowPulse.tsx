import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOR_PRIMARY } from "../theme";

export type GlowPulseProps = {
  /** Glow colour (defaults to the primary orange-red). */
  color?: string;
  /** Diameter of the glow in px. */
  size?: number;
  /** Pulses per second. */
  hz?: number;
};

/**
 * A soft, looping warm-glow pulse behind content. Shared by the cold open and
 * the end card so the series bookends feel visually consistent. Driven off the
 * frame with a continuous sine — loops seamlessly, never janks.
 */
export const GlowPulse: React.FC<GlowPulseProps> = ({ color = COLOR_PRIMARY, size = 1150, hz = 0.5 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 0..1 sine, `hz` cycles per second.
  const wave = (Math.sin((frame / fps) * Math.PI * 2 * hz) + 1) / 2;
  const opacity = interpolate(wave, [0, 1], [0.08, 0.24]);
  const scale = interpolate(wave, [0, 1], [0.92, 1.06]);

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", pointerEvents: "none" }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${color} 0%, transparent 68%)`,
          opacity,
          transform: `scale(${scale})`,
          filter: "blur(24px)"
        }}
      />
    </AbsoluteFill>
  );
};
