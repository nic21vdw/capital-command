import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { fontFamily, theme } from "../theme";

export const TitleLockup: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = (frame / durationInFrames) * Math.PI * 2;
  const glow = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 2));

  return (
    <div
      style={{
        position: "absolute",
        top: 64,
        left: 0,
        right: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontSize: 14,
          letterSpacing: "0.4em",
          textTransform: "uppercase",
          color: theme.soft,
          marginBottom: 12,
          fontWeight: 600,
        }}
      >
        Continuous mix
      </div>

      <div
        style={{
          fontSize: 52,
          fontWeight: 700,
          letterSpacing: "0.16em",
          color: theme.white,
          textAlign: "center",
          lineHeight: 1.05,
          textShadow: `
            0 0 ${18 * glow}px ${theme.magenta}99,
            0 0 ${40 * glow}px ${theme.violet}66
          `,
        }}
      >
        HOUSE
      </div>
    </div>
  );
};
