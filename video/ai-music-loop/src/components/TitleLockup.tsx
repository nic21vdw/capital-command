import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { fontFamily, theme } from "../theme";

export const TitleLockup: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = (frame / durationInFrames) * Math.PI * 2;
  const glow = 0.35 + 0.2 * (0.5 + 0.5 * Math.sin(t * 1.2));

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
      }}
    >
      <div
        style={{
          fontSize: 14,
          letterSpacing: "0.42em",
          textTransform: "uppercase",
          color: theme.muted,
          marginBottom: 14,
          fontWeight: 600,
        }}
      >
        Live Stream Playlist
      </div>

      <div
        style={{
          fontSize: 56,
          fontWeight: 700,
          letterSpacing: "0.06em",
          color: theme.text,
          textAlign: "center",
          lineHeight: 1.05,
          textShadow: `0 0 ${40 * glow}px ${theme.accent}88, 0 0 ${80 * glow}px ${theme.pink}44`,
        }}
      >
        AI MUSIC SESSIONS
      </div>

      <div
        style={{
          marginTop: 16,
          display: "flex",
          alignItems: "center",
          gap: 14,
          color: theme.muted,
          fontSize: 16,
          letterSpacing: "0.08em",
        }}
      >
        <span style={{ color: theme.cyan }}>deep work</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span style={{ color: theme.pink }}>late nights</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span style={{ color: theme.accent }}>building in public</span>
      </div>
    </div>
  );
};
