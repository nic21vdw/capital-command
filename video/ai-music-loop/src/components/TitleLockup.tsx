import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { BEAT_FRAMES, fontFamily, theme } from "../theme";

export const TitleLockup: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = (frame / durationInFrames) * Math.PI * 2;
  const beat = 0.5 + 0.5 * Math.sin((frame / BEAT_FRAMES) * Math.PI * 2);
  const glow = 0.5 + beat * 0.5;
  const scale = 1 + beat * 0.03;

  return (
    <div
      style={{
        position: "absolute",
        top: 56,
        left: 0,
        right: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily,
        pointerEvents: "none",
        transform: `scale(${scale})`,
      }}
    >
      <div
        style={{
          fontSize: 18,
          letterSpacing: "0.55em",
          textTransform: "uppercase",
          color: theme.soft,
          marginBottom: 10,
          fontWeight: 700,
          textShadow: `0 0 18px ${theme.violet}`,
        }}
      >
        Nonstop Mix
      </div>

      <div
        style={{
          fontSize: 78,
          fontWeight: 900,
          letterSpacing: "0.12em",
          color: theme.white,
          textAlign: "center",
          lineHeight: 0.95,
          textShadow: `
            0 0 ${20 * glow}px ${theme.pink},
            0 0 ${50 * glow}px ${theme.magenta},
            0 0 ${90 * glow}px ${theme.purple},
            0 4px 0 ${theme.dim}
          `,
        }}
      >
        HOUSE
      </div>

      <div
        style={{
          marginTop: 6,
          fontSize: 42,
          fontWeight: 800,
          letterSpacing: "0.28em",
          color: theme.pink,
          textAlign: "center",
          textShadow: `
            0 0 ${24 * glow}px ${theme.pink},
            0 0 ${48 * glow}px ${theme.magenta}
          `,
        }}
      >
        SESSIONS
      </div>

      <div
        style={{
          marginTop: 18,
          display: "flex",
          alignItems: "center",
          gap: 16,
          color: theme.soft,
          fontSize: 15,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          fontWeight: 700,
          opacity: 0.85 + 0.15 * Math.sin(t * 2),
        }}
      >
        <span style={{ color: theme.cyan }}>EDM</span>
        <span style={{ opacity: 0.35 }}>//</span>
        <span style={{ color: theme.magenta }}>124 BPM</span>
        <span style={{ opacity: 0.35 }}>//</span>
        <span style={{ color: theme.pink }}>Club Energy</span>
      </div>
    </div>
  );
};
