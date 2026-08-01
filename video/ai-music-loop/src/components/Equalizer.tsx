import React, { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

const BAR_COUNT = 48;

type Bar = {
  phase: number;
  speed: number;
  base: number;
  peak: number;
};

function makeBars(): Bar[] {
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    const seed = i * 9973;
    const centerBias = 1 - Math.abs(i - BAR_COUNT / 2) / (BAR_COUNT / 2);
    return {
      phase: ((seed * 3) % 628) / 100,
      speed: 0.7 + ((seed * 5) % 100) / 100,
      base: 8 + centerBias * 10 + ((seed * 7) % 8),
      peak: 28 + centerBias * 42 + ((seed * 11) % 18),
    };
  });
}

export const Equalizer: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const bars = useMemo(() => makeBars(), []);
  const t = (frame / durationInFrames) * Math.PI * 2;

  const barWidth = 8;
  const gap = 10;
  const totalW = BAR_COUNT * barWidth + (BAR_COUNT - 1) * gap;
  const startX = (width - totalW) / 2;
  const baseY = height - 88;

  return (
    <svg
      width={width}
      height={height}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {bars.map((bar, i) => {
        const wave =
          0.45 +
          0.3 * Math.sin(t * bar.speed + bar.phase) +
          0.25 * Math.sin(t * bar.speed * 1.6 + bar.phase * 1.2);
        const h = bar.base + (bar.peak - bar.base) * Math.max(0.15, wave);
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
            fill={theme.white}
            opacity={0.12 + 0.22 * wave}
          />
        );
      })}
    </svg>
  );
};
