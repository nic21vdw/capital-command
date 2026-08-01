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
  bars: number[],
): string {
  const pts: string[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const a = (i / SAMPLES) * Math.PI * 2;
    const bar = bars[i % bars.length] ?? 0;
    const wave =
      Math.sin(a * 5 + t * 1.2 + phase) * amp * 0.25 +
      Math.sin(a * 9 + t * 0.8 + phase * 1.3) * amp * 0.15 +
      bar * amp * 1.6;
    const r = baseR + wave;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    pts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return pts.join(" ") + " Z";
}

type Props = {
  bars?: number[];
  level?: number;
  bass?: number;
};

export const WaveRing: React.FC<Props> = ({
  bars = [],
  level = 0.15,
  bass = 0.15,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const t = (frame / durationInFrames) * Math.PI * 2;
  const cx = width / 2;
  const cy = height * 0.5;
  const breath = Math.min(1, level * 1.6);
  const thump = Math.min(1, bass * 2);
  const ringBars =
    bars.length > 0
      ? bars
      : Array.from({ length: 64 }, (_, i) => 0.12 + 0.08 * Math.sin(t * 2 + i));

  const rings = [
    {
      base: 130,
      amp: 10 + breath * 28 + thump * 12,
      color: theme.coral,
      op: 0.45 + breath * 0.4,
      w: 2.2,
    },
    {
      base: 175,
      amp: 8 + breath * 22 + thump * 10,
      color: theme.magenta,
      op: 0.35 + breath * 0.3,
      w: 1.8,
    },
    {
      base: 225,
      amp: 7 + breath * 18,
      color: theme.violet,
      op: 0.25 + breath * 0.22,
      w: 1.4,
    },
    {
      base: 280,
      amp: 6 + breath * 14,
      color: theme.cyan,
      op: 0.16 + breath * 0.16,
      w: 1.1,
    },
  ];

  return (
    <svg
      width={width}
      height={height}
      style={{ position: "absolute", inset: 0 }}
    >
      <defs>
        <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={theme.white} stopOpacity="0.4" />
          <stop offset="22%" stopColor={theme.magenta} stopOpacity="0.32" />
          <stop offset="55%" stopColor={theme.violet} stopOpacity="0.14" />
          <stop offset="100%" stopColor={theme.bg} stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle
        cx={cx}
        cy={cy}
        r={210 + breath * 50 + thump * 24}
        fill="url(#coreGlow)"
        opacity={0.55 + breath * 0.45}
      />

      {rings.map((ring, i) => (
        <path
          key={i}
          d={ringPath(cx, cy, ring.base, ring.amp, t, i * 1.35, ringBars)}
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
        r={5 + breath * 6 + thump * 4}
        fill={theme.white}
        opacity={0.55 + breath * 0.4}
      />
      <circle
        cx={cx}
        cy={cy}
        r={16 + breath * 10}
        fill="none"
        stroke={theme.cyan}
        strokeWidth={1.2}
        opacity={0.25 + breath * 0.35}
      />
    </svg>
  );
};
