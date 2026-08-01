import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { fontFamily, theme } from "../theme";

export const TitleLockup: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = (frame / durationInFrames) * Math.PI * 2;
  const opacity = 0.72 + 0.08 * Math.sin(t);

  return (
    <div
      style={{
        position: "absolute",
        top: 72,
        left: 0,
        right: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily,
        pointerEvents: "none",
        opacity,
      }}
    >
      <div
        style={{
          fontSize: 13,
          letterSpacing: "0.42em",
          textTransform: "uppercase",
          color: theme.soft,
          marginBottom: 14,
          fontWeight: 500,
        }}
      >
        Continuous mix
      </div>

      <div
        style={{
          fontSize: 42,
          fontWeight: 500,
          letterSpacing: "0.18em",
          color: theme.white,
          textAlign: "center",
          lineHeight: 1.1,
        }}
      >
        HOUSE
      </div>
    </div>
  );
};
