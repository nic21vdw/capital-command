import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { GlowBackground } from "../components/GlowBackground";
import { theme, fontFamily } from "../theme";

/**
 * The pivot beat: "so where do you start?" → STEP 1: choose the right model.
 * This is the single instruction the intro leaves the viewer with.
 */
export const StepOne: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const chip = spring({ frame, fps, config: { damping: 16 } });
  const title = spring({ frame: frame - 20, fps, config: { damping: 14 } });
  const sub = spring({ frame: frame - 55, fps, config: { damping: 16 } });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 80 }}>
      <GlowBackground color={theme.reveal} />
      <div
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize: 48,
          letterSpacing: 10,
          color: theme.bg,
          backgroundColor: theme.reveal,
          borderRadius: 999,
          padding: "18px 54px",
          opacity: chip,
          transform: `translateY(${interpolate(chip, [0, 1], [40, 0])}px)`,
        }}
      >
        STEP 1
      </div>
      <div
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize: 108,
          color: theme.text,
          textAlign: "center",
          lineHeight: 1.08,
          letterSpacing: -3,
          marginTop: 52,
          maxWidth: 900,
          opacity: title,
          transform: `scale(${interpolate(title, [0, 1], [0.85, 1])})`,
        }}
      >
        Choose the
        <br />
        right model
      </div>
      <div
        style={{
          fontFamily,
          fontWeight: 600,
          fontSize: 46,
          color: theme.muted,
          textAlign: "center",
          marginTop: 44,
          opacity: sub,
          transform: `translateY(${interpolate(sub, [0, 1], [24, 0])}px)`,
        }}
      >
        Every revolution starts with the right machine
      </div>
    </AbsoluteFill>
  );
};
