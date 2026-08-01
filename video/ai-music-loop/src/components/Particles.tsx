import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

const COLORS = [
  theme.cyan,
  theme.magenta,
  theme.coral,
  theme.gold,
  theme.white,
  theme.violet,
];

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
      size: 1.4 + ((seed * 7) % 28) / 10,
      color: COLORS[i % COLORS.length],
      speed: 0.45 + ((seed * 13) % 100) / 100,
      phase: ((seed * 3) % 628) / 100,
      drift: 18 + ((seed * 11) % 36),
    });
  }
  return out;
}

type Props = {
  level?: number;
  high?: number;
};

export const Particles: React.FC<Props> = ({ level = 0.15, high = 0.15 }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const particles = useMemo(() => makeParticles(42), []);
  const t = (frame / durationInFrames) * Math.PI * 2;
  const energy = Math.min(1, level * 1.7);
  const sparkle = Math.min(1, high * 2);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {particles.map((p, i) => {
        const x =
          p.x * 100 +
          Math.sin(t * p.speed + p.phase) * (p.drift / 19.2) * (1 + energy);
        const y =
          p.y * 100 +
          Math.cos(t * p.speed * 0.7 + p.phase) * (p.drift / 10.8) -
          energy * 2;
        const opacity =
          0.1 +
          0.25 * energy +
          0.4 * sparkle * (0.5 + 0.5 * Math.sin(t * p.speed * 1.4 + p.phase));
        const size =
          p.size *
          (0.85 + energy * 0.5 + sparkle * 0.35) *
          (0.9 + 0.25 * (0.5 + 0.5 * Math.sin(t * p.speed + p.phase)));

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: `${y}%`,
              width: size,
              height: size,
              borderRadius: "50%",
              backgroundColor: p.color,
              opacity,
              boxShadow: `0 0 ${size * (2.5 + energy * 3)}px ${p.color}`,
              transform: "translate(-50%, -50%)",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
