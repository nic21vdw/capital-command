import React, { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

const BAR_COUNT = 64;
const COLORS = [theme.accent, theme.pink, theme.cyan, theme.green];

type Bar = {
  phase: number;
  speed: number;
  base: number;
  peak: number;
  color: string;
};

function makeBars(): Bar[] {
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    const seed = i * 9973;
    const centerBias = 1 - Math.abs(i - BAR_COUNT / 2) / (BAR_COUNT / 2);
    return {
      phase: ((seed * 3) % 628) / 100,
      speed: 0.8 + ((seed * 5) % 120) / 100,
      base: 18 + centerBias * 24 + ((seed * 7) % 20),
      peak: 50 + centerBias * 90 + ((seed * 11) % 40),
      color: COLORS[i % COLORS.length],
    };
  });
}

export const Equalizer: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const bars = useMemo(() => makeBars(), []);
  const t = (frame / durationInFrames) * Math.PI * 2;

  const barWidth = 14;
  const gap = 8;
  const totalW = BAR_COUNT * barWidth + (BAR_COUNT - 1) * gap;
  const startX = (width - totalW) / 2;
  const baseY = height - 96;

  return (
    <svg
      width={width}
      height={height}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {bars.map((bar, i) => {
        const wave =
          0.55 +
          0.25 * Math.sin(t * bar.speed + bar.phase) +
          0.2 * Math.sin(t * bar.speed * 1.7 + bar.phase * 1.3);
        const h = bar.base + (bar.peak - bar.base) * Math.max(0.12, wave);
        const x = startX + i * (barWidth + gap);
        const y = baseY - h;

        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barWidth}
            height={h}
            rx={barWidth / 2}
            fill={bar.color}
            opacity={0.55 + 0.35 * wave}
          />
        );
      })}
    </svg>
  );
};
