import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

const ORBS = [
  { x: 0.22, y: 0.3, size: 820, color: theme.violet, s: 0.7, p: 0.3, a: 0.28 },
  { x: 0.78, y: 0.26, size: 720, color: theme.magenta, s: 0.55, p: 1.6, a: 0.22 },
  { x: 0.5, y: 0.7, size: 900, color: theme.cyan, s: 0.6, p: 2.4, a: 0.18 },
  { x: 0.35, y: 0.55, size: 520, color: theme.coral, s: 0.8, p: 3.5, a: 0.14 },
  { x: 0.68, y: 0.58, size: 480, color: theme.gold, s: 0.5, p: 4.2, a: 0.1 },
];

export const AmbientBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = (frame / durationInFrames) * Math.PI * 2;

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at 50% 42%, ${theme.surface} 0%, ${theme.bg} 68%)`,
        overflow: "hidden",
      }}
    >
      {ORBS.map((orb, i) => {
        const driftX = Math.sin(t * orb.s + orb.p) * 42;
        const driftY = Math.cos(t * orb.s * 0.75 + orb.p) * 28;
        const scale = 0.92 + 0.12 * (0.5 + 0.5 * Math.sin(t * orb.s * 1.2 + orb.p));
        const opacity =
          orb.a * (0.75 + 0.35 * (0.5 + 0.5 * Math.sin(t * orb.s + orb.p)));

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
              filter: "blur(28px)",
            }}
          />
        );
      })}

      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 50% 55%, transparent 28%, rgba(7,6,15,0.62) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
