import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { theme, fontFamily } from "../theme";

/** CTA beat: "COMMENT BELOW" bounces in with a subtle attention pulse. */
export const CommentCTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 10, mass: 0.8 } });
  const pulse = 1 + 0.03 * Math.sin((frame / 12) * Math.PI);
  const sub = spring({ frame: frame - 16, fps, config: { damping: 16 } });

  return (
    <AbsoluteFill
      style={{ backgroundColor: theme.bg, justifyContent: "center", alignItems: "center" }}
    >
      <div
        style={{
          transform: `scale(${interpolate(enter, [0, 1], [0.7, 1]) * pulse})`,
          opacity: enter,
          backgroundColor: theme.accent,
          color: theme.bg,
          fontFamily,
          fontWeight: 800,
          fontSize: 92,
          padding: "28px 56px",
          borderRadius: 28,
          letterSpacing: -2,
        }}
      >
        COMMENT BELOW
      </div>
      <div
        style={{
          marginTop: 44,
          fontFamily,
          fontWeight: 600,
          fontSize: 50,
          color: theme.text,
          opacity: sub,
          transform: `translateY(${interpolate(sub, [0, 1], [24, 0])}px)`,
          textAlign: "center",
        }}
      >
        Tell me what you want built
      </div>
    </AbsoluteFill>
  );
};
