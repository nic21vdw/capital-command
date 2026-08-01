import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

const RAY_COUNT = 12;

export const LightRays: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const t = (frame / durationInFrames) * Math.PI * 2;
  const cx = width / 2;
  const cy = height * 0.5;
  const spin = (frame / durationInFrames) * 28;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg width={width} height={height}>
        <defs>
          <linearGradient id="rayGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={theme.magenta} stopOpacity="0" />
            <stop offset="50%" stopColor={theme.violet} stopOpacity="0.55" />
            <stop offset="100%" stopColor={theme.cyan} stopOpacity="0" />
          </linearGradient>
        </defs>
        <g transform={`rotate(${spin} ${cx} ${cy})`}>
          {Array.from({ length: RAY_COUNT }).map((_, i) => {
            const a = (i / RAY_COUNT) * Math.PI * 2;
            const len = 380 + 70 * Math.sin(t * 1.5 + i * 0.8);
            const x2 = cx + Math.cos(a) * len;
            const y2 = cy + Math.sin(a) * len;
            const opacity = 0.1 + 0.12 * (0.5 + 0.5 * Math.sin(t * 2 + i));

            return (
              <line
                key={i}
                x1={cx}
                y1={cy}
                x2={x2}
                y2={y2}
                stroke="url(#rayGrad)"
                strokeWidth={2.5}
                opacity={opacity}
              />
            );
          })}
        </g>
      </svg>
    </AbsoluteFill>
  );
};
