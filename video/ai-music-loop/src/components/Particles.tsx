import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

const COLORS = [theme.accent, theme.pink, theme.cyan, theme.text];

type Particle = {
  x: number;
  y: number;
  size: number;
  color: string;
  speed: number;
  phase: number;
  drift: number;
};

function makeParticles(count: number): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const seed = i * 7919;
    out.push({
      x: ((seed * 17) % 1000) / 1000,
      y: ((seed * 31) % 1000) / 1000,
      size: 1.5 + ((seed * 7) % 30) / 10,
      color: COLORS[i % COLORS.length],
      speed: 0.4 + ((seed * 13) % 100) / 100,
      phase: ((seed * 3) % 628) / 100,
      drift: 20 + ((seed * 11) % 40),
    });
  }
  return out;
}

export const Particles: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const particles = useMemo(() => makeParticles(48), []);
  const t = (frame / durationInFrames) * Math.PI * 2;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {particles.map((p, i) => {
        const x = p.x * 100 + Math.sin(t * p.speed + p.phase) * (p.drift / 19.2);
        const y =
          p.y * 100 + Math.cos(t * p.speed * 0.7 + p.phase) * (p.drift / 10.8);
        const opacity =
          0.15 + 0.45 * (0.5 + 0.5 * Math.sin(t * p.speed * 1.5 + p.phase));

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: `${y}%`,
              width: p.size,
              height: p.size,
              borderRadius: "50%",
              backgroundColor: p.color,
              opacity,
              boxShadow: `0 0 ${p.size * 3}px ${p.color}`,
              transform: "translate(-50%, -50%)",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
