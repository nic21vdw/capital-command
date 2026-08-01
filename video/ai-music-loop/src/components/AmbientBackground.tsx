import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

export const AmbientBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = (frame / durationInFrames) * Math.PI * 2;

  const lights = [
    { x: 0.28, y: 0.32, size: 980, color: "rgba(180, 190, 210, 0.14)", s: 0.55, p: 0.4 },
    { x: 0.72, y: 0.28, size: 860, color: "rgba(200, 185, 165, 0.10)", s: 0.4, p: 1.8 },
    { x: 0.5, y: 0.62, size: 1100, color: "rgba(140, 155, 175, 0.09)", s: 0.48, p: 2.9 },
  ];

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at 50% 40%, ${theme.surface} 0%, ${theme.bg} 72%)`,
        overflow: "hidden",
      }}
    >
      {lights.map((light, i) => {
        const driftX = Math.sin(t * light.s + light.p) * 28;
        const driftY = Math.cos(t * light.s * 0.7 + light.p) * 18;
        const pulse = 0.75 + 0.25 * Math.sin(t * light.s + light.p);

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${light.x * 100}%`,
              top: `${light.y * 100}%`,
              width: light.size,
              height: light.size,
              transform: `translate(calc(-50% + ${driftX}px), calc(-50% + ${driftY}px))`,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${light.color} 0%, transparent 70%)`,
              opacity: pulse,
              filter: "blur(40px)",
            }}
          />
        );
      })}

      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 50% 55%, transparent 35%, rgba(0,0,0,0.55) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
