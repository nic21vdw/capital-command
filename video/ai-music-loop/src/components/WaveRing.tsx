import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

const SAMPLES = 96;

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
      Math.sin(a * 5 + t * 1.1 + phase) * amp * 0.55 +
      Math.sin(a * 9 + t * 0.7 + phase * 1.3) * amp * 0.3 +
      Math.sin(a * 3 + t * 0.9 + phase * 0.6) * amp * 0.25;
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
  const breath = 0.5 + 0.5 * Math.sin(t);

  const rings = [
    { base: 140, amp: 8 + breath * 6, op: 0.55, w: 1.2 },
    { base: 190, amp: 6 + breath * 5, op: 0.32, w: 1 },
    { base: 245, amp: 5 + breath * 4, op: 0.18, w: 0.8 },
  ];

  return (
    <svg
      width={width}
      height={height}
      style={{ position: "absolute", inset: 0 }}
    >
      <defs>
        <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={theme.glow} stopOpacity="0.18" />
          <stop offset="45%" stopColor={theme.cool} stopOpacity="0.06" />
          <stop offset="100%" stopColor={theme.bg} stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle
        cx={cx}
        cy={cy}
        r={220 + breath * 12}
        fill="url(#coreGlow)"
        opacity={0.9}
      />

      {rings.map((ring, i) => (
        <path
          key={i}
          d={ringPath(cx, cy, ring.base, ring.amp, t, i * 1.4)}
          fill="none"
          stroke={theme.white}
          strokeWidth={ring.w}
          opacity={ring.op}
          strokeLinejoin="round"
        />
      ))}

      <circle
        cx={cx}
        cy={cy}
        r={3.5}
        fill={theme.white}
        opacity={0.45 + breath * 0.2}
      />
    </svg>
  );
};
