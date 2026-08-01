import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

const RING_COUNT = 3;
const SAMPLES = 96;

function ringPath(
  cx: number,
  cy: number,
  baseR: number,
  amp: number,
  t: number,
  phase: number,
  harmonics: number,
): string {
  const pts: string[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const a = (i / SAMPLES) * Math.PI * 2;
    let wave = 0;
    for (let h = 1; h <= harmonics; h++) {
      wave +=
        Math.sin(a * (3 + h) + t * (0.8 + h * 0.35) + phase) *
        (amp / (h * 1.4));
    }
    const r = baseR + wave;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    pts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return pts.join(" ") + " Z";
}

export const WaveRing: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const t = (frame / durationInFrames) * Math.PI * 2;
  const cx = width / 2;
  const cy = height / 2 - 20;

  const rings = Array.from({ length: RING_COUNT }, (_, i) => {
    const baseR = 150 + i * 55;
    const amp = 10 + i * 6 + 8 * (0.5 + 0.5 * Math.sin(t * 1.2 + i));
    const opacity = 0.55 - i * 0.12;
    const colors = [theme.accent, theme.pink, theme.cyan];
    return {
      d: ringPath(cx, cy, baseR, amp, t, i * 1.7, 3 + i),
      color: colors[i % colors.length],
      opacity,
      strokeWidth: 2.2 - i * 0.3,
    };
  });

  const corePulse = 0.55 + 0.25 * (0.5 + 0.5 * Math.sin(t * 2));
  const coreScale = 0.94 + 0.08 * (0.5 + 0.5 * Math.sin(t * 1.5));

  return (
    <svg
      width={width}
      height={height}
      style={{ position: "absolute", inset: 0 }}
    >
      <defs>
        <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={theme.accent} stopOpacity="0.55" />
          <stop offset="45%" stopColor={theme.pink} stopOpacity="0.18" />
          <stop offset="100%" stopColor={theme.bg} stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle
        cx={cx}
        cy={cy}
        r={210 * coreScale}
        fill="url(#coreGlow)"
        opacity={corePulse}
      />

      {rings.map((ring, i) => (
        <path
          key={i}
          d={ring.d}
          fill="none"
          stroke={ring.color}
          strokeWidth={ring.strokeWidth}
          opacity={ring.opacity}
          strokeLinejoin="round"
        />
      ))}

      <circle
        cx={cx}
        cy={cy}
        r={42 + 6 * Math.sin(t * 2)}
        fill="none"
        stroke={theme.text}
        strokeWidth={1.5}
        opacity={0.35}
      />
      <circle
        cx={cx}
        cy={cy}
        r={8}
        fill={theme.pink}
        opacity={0.85 + 0.15 * Math.sin(t * 3)}
      />
    </svg>
  );
};
