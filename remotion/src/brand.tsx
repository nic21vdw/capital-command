import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";

// Claude's signature "clay/coral" accent and a stylized starburst spark, in the
// Anthropic visual style. This is an original homage motif — not the official
// trademarked logo asset — for personal video branding.
export const CLAUDE_CORAL = "#D97757";
export const CLAUDE_CREAM = "#F0EEE6";

// A radiating spark: N tapered rays with a little organic length variation,
// like the Anthropic sunburst.
export const ClaudeSpark: React.FC<{
  size: number;
  color?: string;
  opacity?: number;
  spin?: number;
}> = ({ size, color = CLAUDE_CORAL, opacity = 1, spin = 0 }) => {
  const rays = 12;
  const c = size / 2;
  const inner = size * 0.1;
  const outer = size * 0.5;
  const variation = [1, 0.72, 0.88, 0.72]; // repeating pattern -> organic feel
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ transform: `rotate(${spin}deg)`, display: "block" }}
    >
      <g
        stroke={color}
        strokeWidth={size * 0.055}
        strokeLinecap="round"
        opacity={opacity}
      >
        {Array.from({ length: rays }).map((_, i) => {
          const a = ((i * (360 / rays)) * Math.PI) / 180;
          const len = outer * variation[i % variation.length];
          return (
            <line
              key={i}
              x1={c + Math.cos(a) * inner}
              y1={c + Math.sin(a) * inner}
              x2={c + Math.cos(a) * len}
              y2={c + Math.sin(a) * len}
            />
          );
        })}
      </g>
    </svg>
  );
};

// A few sparks scattered as a background/foreground brand layer: one big and
// very faint for texture, one crisp accent, one tiny sparkle. Slow rotation.
export const BrandDecor: React.FC = () => {
  const frame = useCurrentFrame();
  const spin = frame * 0.25;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", bottom: -160, left: -160 }}>
        <ClaudeSpark size={560} spin={-spin * 0.4} opacity={0.05} />
      </div>
      <div style={{ position: "absolute", top: 72, right: 96 }}>
        <ClaudeSpark size={72} spin={spin} opacity={0.95} />
      </div>
      <div style={{ position: "absolute", top: 128, right: 210 }}>
        <ClaudeSpark size={24} spin={spin * 1.6} opacity={0.5} />
      </div>
    </AbsoluteFill>
  );
};
