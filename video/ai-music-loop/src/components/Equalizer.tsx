import React, { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { BEAT_FRAMES, theme } from "../theme";

const BAR_COUNT = 72;
const COLORS = [theme.pink, theme.magenta, theme.violet, theme.purple, theme.cyan];

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
      speed: 1 + ((seed * 5) % 140) / 100,
      base: 20 + centerBias * 30 + ((seed * 7) % 18),
      peak: 70 + centerBias * 160 + ((seed * 11) % 50),
      color: COLORS[i % COLORS.length],
    };
  });
}

export const Equalizer: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const bars = useMemo(() => makeBars(), []);
  const t = (frame / durationInFrames) * Math.PI * 2;
  const beat = 0.5 + 0.5 * Math.sin((frame / BEAT_FRAMES) * Math.PI * 2);

  const barWidth = 12;
  const gap = 6;
  const totalW = BAR_COUNT * barWidth + (BAR_COUNT - 1) * gap;
  const startX = (width - totalW) / 2;
  const baseY = height - 70;

  return (
    <svg
      width={width}
      height={height}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <defs>
        <linearGradient id="barGrad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={theme.purple} />
          <stop offset="55%" stopColor={theme.magenta} />
          <stop offset="100%" stopColor={theme.pink} />
        </linearGradient>
      </defs>
      {bars.map((bar, i) => {
        const wave =
          0.35 +
          0.35 * beat +
          0.2 * Math.sin(t * bar.speed + bar.phase) +
          0.1 * Math.sin(t * bar.speed * 2.1 + bar.phase * 1.4);
        const h = bar.base + (bar.peak - bar.base) * Math.max(0.1, wave);
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
            fill="url(#barGrad)"
            opacity={0.55 + 0.4 * wave}
          />
        );
      })}
    </svg>
  );
};
