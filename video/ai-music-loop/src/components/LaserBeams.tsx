import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { BEAT_FRAMES, theme } from "../theme";

const BEAMS = 18;

export const LaserBeams: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const t = (frame / durationInFrames) * Math.PI * 2;
  const beat = 0.5 + 0.5 * Math.sin((frame / BEAT_FRAMES) * Math.PI * 2);
  const cx = width / 2;
  const cy = height * 0.48;
  const spin = (frame / durationInFrames) * 360;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg width={width} height={height}>
        <defs>
          <linearGradient id="beamGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={theme.magenta} stopOpacity="0" />
            <stop offset="50%" stopColor={theme.violet} stopOpacity="0.85" />
            <stop offset="100%" stopColor={theme.cyan} stopOpacity="0" />
          </linearGradient>
        </defs>
        <g transform={`rotate(${spin} ${cx} ${cy})`}>
          {Array.from({ length: BEAMS }).map((_, i) => {
            const a = (i / BEAMS) * Math.PI * 2;
            const len = 520 + 120 * Math.sin(t * 2 + i * 0.7) + beat * 80;
            const x2 = cx + Math.cos(a) * len;
            const y2 = cy + Math.sin(a) * len;
            const opacity = 0.12 + beat * 0.22 + 0.08 * Math.sin(t * 3 + i);

            return (
              <line
                key={i}
                x1={cx}
                y1={cy}
                x2={x2}
                y2={y2}
                stroke="url(#beamGrad)"
                strokeWidth={2 + beat * 2}
                opacity={opacity}
              />
            );
          })}
        </g>
      </svg>
    </AbsoluteFill>
  );
};
