import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { BEAT_FRAMES, theme } from "../theme";

export const FloorGrid: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const t = (frame / durationInFrames) * Math.PI * 2;
  const beat = 0.5 + 0.5 * Math.sin((frame / BEAT_FRAMES) * Math.PI * 2);
  const scroll = ((frame / durationInFrames) % 1) * 80;

  const linesH: React.ReactNode[] = [];
  const linesV: React.ReactNode[] = [];
  const horizon = height * 0.62;
  const floorH = height - horizon;

  for (let i = 0; i < 16; i++) {
    const p = (i + scroll / 80) / 16;
    const y = horizon + Math.pow(p, 1.6) * floorH;
    const opacity = 0.08 + p * 0.35;
    linesH.push(
      <line
        key={`h${i}`}
        x1={0}
        y1={y}
        x2={width}
        y2={y}
        stroke={theme.violet}
        strokeWidth={1.5}
        opacity={opacity + beat * 0.08}
      />,
    );
  }

  for (let i = -12; i <= 12; i++) {
    const topX = width / 2 + i * 48;
    const botX = width / 2 + i * 220;
    linesV.push(
      <line
        key={`v${i}`}
        x1={topX}
        y1={horizon}
        x2={botX}
        y2={height}
        stroke={theme.magenta}
        strokeWidth={1.2}
        opacity={0.12 + beat * 0.1}
      />,
    );
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg width={width} height={height}>
        <defs>
          <linearGradient id="floorFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={theme.purple} stopOpacity="0" />
            <stop offset="40%" stopColor={theme.purple} stopOpacity="0.18" />
            <stop offset="100%" stopColor={theme.pink} stopOpacity="0.35" />
          </linearGradient>
        </defs>
        <rect
          x={0}
          y={horizon}
          width={width}
          height={floorH}
          fill="url(#floorFade)"
          opacity={0.7 + 0.15 * Math.sin(t)}
        />
        {linesH}
        {linesV}
        <line
          x1={0}
          y1={horizon}
          x2={width}
          y2={horizon}
          stroke={theme.soft}
          strokeWidth={2}
          opacity={0.25 + beat * 0.2}
        />
      </svg>
    </AbsoluteFill>
  );
};
