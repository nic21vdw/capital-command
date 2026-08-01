import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { BEAT_FRAMES, theme } from "../theme";

export const AmbientBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = (frame / durationInFrames) * Math.PI * 2;
  const beat = 0.5 + 0.5 * Math.sin((frame / BEAT_FRAMES) * Math.PI * 2);

  const orbs = [
    { x: 0.2, y: 0.25, size: 900, color: theme.purple, s: 1, p: 0.2 },
    { x: 0.8, y: 0.3, size: 820, color: theme.magenta, s: 0.85, p: 1.4 },
    { x: 0.5, y: 0.75, size: 1000, color: theme.pink, s: 1.1, p: 2.5 },
    { x: 0.15, y: 0.7, size: 560, color: theme.blue, s: 0.7, p: 3.6 },
    { x: 0.85, y: 0.7, size: 520, color: theme.violet, s: 0.9, p: 4.8 },
  ];

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(165deg, ${theme.bgDeep} 0%, ${theme.bgMid} 42%, #2a0a4a 72%, #1a0538 100%)`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 50% 35%, ${theme.purple}55 0%, transparent 55%)`,
          opacity: 0.45 + beat * 0.25,
        }}
      />

      {orbs.map((orb, i) => {
        const driftX = Math.sin(t * orb.s + orb.p) * 60;
        const driftY = Math.cos(t * orb.s * 0.75 + orb.p) * 40;
        const scale = 0.88 + 0.18 * beat + 0.08 * Math.sin(t * orb.s + orb.p);
        const opacity = 0.28 + 0.22 * beat;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${orb.x * 100}%`,
              top: `${orb.y * 100}%`,
              width: orb.size,
              height: orb.size,
              transform: `translate(calc(-50% + ${driftX}px), calc(-50% + ${driftY}px)) scale(${scale})`,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${orb.color} 0%, transparent 68%)`,
              opacity,
              filter: "blur(6px)",
            }}
          />
        );
      })}

      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 50% 60%, transparent 25%, rgba(5,0,16,0.72) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
