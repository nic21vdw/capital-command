import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { BEAT_FRAMES, theme } from "../theme";

const SAMPLES = 120;

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
        Math.sin(a * (4 + h * 2) + t * (1.2 + h * 0.4) + phase) *
        (amp / (h * 1.15));
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
  const beat = 0.5 + 0.5 * Math.sin((frame / BEAT_FRAMES) * Math.PI * 2);
  const cx = width / 2;
  const cy = height * 0.46;

  const rings = [
    { base: 120, amp: 18 + beat * 22, color: theme.pink, op: 0.95, w: 3.5, h: 4 },
    { base: 175, amp: 14 + beat * 18, color: theme.magenta, op: 0.75, w: 2.8, h: 3 },
    { base: 235, amp: 12 + beat * 14, color: theme.violet, op: 0.55, w: 2.2, h: 3 },
    { base: 300, amp: 10 + beat * 12, color: theme.cyan, op: 0.35, w: 1.6, h: 2 },
  ];

  const coreScale = 0.9 + beat * 0.22;

  return (
    <svg
      width={width}
      height={height}
      style={{ position: "absolute", inset: 0 }}
    >
      <defs>
        <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={theme.white} stopOpacity="0.9" />
          <stop offset="18%" stopColor={theme.pink} stopOpacity="0.7" />
          <stop offset="48%" stopColor={theme.purple} stopOpacity="0.35" />
          <stop offset="100%" stopColor={theme.bgDeep} stopOpacity="0" />
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <circle
        cx={cx}
        cy={cy}
        r={260 * coreScale}
        fill="url(#coreGlow)"
        opacity={0.55 + beat * 0.3}
      />

      {rings.map((ring, i) => (
        <path
          key={i}
          d={ringPath(cx, cy, ring.base, ring.amp, t, i * 1.3, ring.h)}
          fill="none"
          stroke={ring.color}
          strokeWidth={ring.w}
          opacity={ring.op}
          strokeLinejoin="round"
          filter="url(#glow)"
        />
      ))}

      <circle
        cx={cx}
        cy={cy}
        r={28 + beat * 10}
        fill={theme.white}
        opacity={0.85}
      />
      <circle
        cx={cx}
        cy={cy}
        r={14 + beat * 6}
        fill={theme.pink}
        opacity={1}
      />
    </svg>
  );
};
