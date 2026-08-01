import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

const ORBS = [
  { x: 0.18, y: 0.28, size: 720, color: theme.accent, speed: 1, phase: 0.4 },
  { x: 0.78, y: 0.22, size: 560, color: theme.pink, speed: 0.7, phase: 1.1 },
  { x: 0.55, y: 0.72, size: 640, color: theme.cyan, speed: 0.9, phase: 2.2 },
  { x: 0.32, y: 0.68, size: 420, color: theme.accent, speed: 1.2, phase: 3.4 },
  { x: 0.88, y: 0.68, size: 380, color: theme.pink, speed: 0.85, phase: 4.1 },
];

export const AmbientBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = (frame / durationInFrames) * Math.PI * 2;

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at 50% 40%, ${theme.surface} 0%, ${theme.bg} 70%)`,
        overflow: "hidden",
      }}
    >
      {ORBS.map((orb, i) => {
        const driftX = Math.sin(t * orb.speed + orb.phase) * 48;
        const driftY = Math.cos(t * orb.speed * 0.8 + orb.phase) * 36;
        const pulse =
          0.14 +
          0.1 * (0.5 + 0.5 * Math.sin(t * orb.speed * 1.4 + orb.phase));
        const scale =
          0.92 + 0.12 * (0.5 + 0.5 * Math.sin(t * orb.speed + orb.phase * 0.5));

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
              opacity: pulse,
              filter: "blur(8px)",
            }}
          />
        );
      })}

      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 50% 55%, transparent 30%, rgba(11,12,18,0.55) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
