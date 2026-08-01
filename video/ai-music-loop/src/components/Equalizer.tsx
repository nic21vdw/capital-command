import React from "react";
import { useVideoConfig } from "remotion";
import { theme } from "../theme";

const COLORS = [theme.cyan, theme.violet, theme.magenta, theme.coral, theme.gold];

type Props = {
  bars?: number[];
};

export const Equalizer: React.FC<Props> = ({ bars = [] }) => {
  const { width, height } = useVideoConfig();
  const values =
    bars.length > 0
      ? bars
      : Array.from({ length: 56 }, () => 0.08);

  const barWidth = 10;
  const gap = 7;
  const totalW = values.length * barWidth + (values.length - 1) * gap;
  const startX = (width - totalW) / 2;
  const baseY = height - 80;
  const maxH = 210;

  return (
    <svg
      width={width}
      height={height}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {values.map((raw, i) => {
        const value = Math.min(1, Math.pow(Math.max(0, raw), 0.85) * 1.35);
        const h = 10 + value * maxH;
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
            fill={COLORS[i % COLORS.length]}
            opacity={0.25 + value * 0.7}
          />
        );
      })}
    </svg>
  );
};
