import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

const SAMPLES = 108;

function ringPath(
  cx: number,
  cy: number,
  baseR: number,
  amp: number,
  t: number,
  phase: number,
): string {
  const pts: string[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const a = (i / SAMPLES) * Math.PI * 2;
    const wave =
      Math.sin(a * 5 + t * 1.2 + phase) * amp * 0.5 +
      Math.sin(a * 9 + t * 0.8 + phase * 1.3) * amp * 0.28 +
      Math.sin(a * 3 + t * 1.0 + phase * 0.6) * amp * 0.22;
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
  const cy = height * 0.5;
  const breath = 0.5 + 0.5 * Math.sin(t * 2);

  const rings = [
    { base: 130, amp: 14 + breath * 10, color: theme.coral, op: 0.75, w: 2.2 },
    { base: 175, amp: 12 + breath * 8, color: theme.magenta, op: 0.55, w: 1.8 },
    { base: 225, amp: 10 + breath * 7, color: theme.violet, op: 0.38, w: 1.4 },
    { base: 280, amp: 8 + breath * 6, color: theme.cyan, op: 0.24, w: 1.1 },
  ];

  return (
    <svg
      width={width}
      height={height}
      style={{ position: "absolute", inset: 0 }}
    >
      <defs>
        <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={theme.white} stopOpacity="0.35" />
          <stop offset="22%" stopColor={theme.magenta} stopOpacity="0.28" />
          <stop offset="55%" stopColor={theme.violet} stopOpacity="0.12" />
          <stop offset="100%" stopColor={theme.bg} stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle
        cx={cx}
        cy={cy}
        r={230 + breath * 18}
        fill="url(#coreGlow)"
        opacity={0.85 + breath * 0.15}
      />

      {rings.map((ring, i) => (
        <path
          key={i}
          d={ringPath(cx, cy, ring.base, ring.amp, t, i * 1.35)}
          fill="none"
          stroke={ring.color}
          strokeWidth={ring.w}
          opacity={ring.op}
          strokeLinejoin="round"
        />
      ))}

      <circle
        cx={cx}
        cy={cy}
        r={6 + breath * 3}
        fill={theme.white}
        opacity={0.7 + breath * 0.25}
      />
      <circle
        cx={cx}
        cy={cy}
        r={18 + breath * 6}
        fill="none"
        stroke={theme.cyan}
        strokeWidth={1.2}
        opacity={0.35 + breath * 0.2}
      />
    </svg>
  );
};
