import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  random,
} from "remotion";
import { COLORS, hexA, VIDEO } from "../config";
import { NodeField } from "./NodeField";

/**
 * SplitScreen — the thesis visual: a muted, turned-away crowd on the left
 * (the resistance) vs. a glowing purple→pink network rising on the right
 * (the future). Builds over `build` progress (0-1).
 */
export const SplitScreen: React.FC<{
  build: number; // 0-1
}> = ({ build }) => {
  const frame = useCurrentFrame();
  const { width, height } = VIDEO;

  // The dividing seam sweeps slightly as it builds.
  const seam = interpolate(build, [0, 1], [0.52, 0.48], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Crowd silhouettes (deterministic).
  const crowd = Array.from({ length: 22 }).map((_, i) => {
    const x = 0.02 + random(`cx-${i}`) * (seam - 0.08);
    const scale = 0.7 + random(`cs-${i}`) * 0.7;
    const yBase = 0.62 + random(`cy-${i}`) * 0.12;
    return { x, scale, yBase, i };
  });

  return (
    <AbsoluteFill>
      {/* LEFT — cold, muted resistance */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${hexA(
            COLORS.muted,
            0.14,
          )} 0%, ${COLORS.backgroundDeep} 100%)`,
          clipPath: `polygon(0 0, ${seam * 100}% 0, ${
            seam * 100 - 3
          }% 100%, 0 100%)`,
        }}
      >
        <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
          {crowd.map((c) => {
            const cx = c.x * width;
            const h = 190 * c.scale;
            const w = 70 * c.scale;
            const cy = c.yBase * height;
            const appear = interpolate(build, [0, 0.6], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            return (
              <g key={c.i} opacity={0.55 * appear}>
                {/* head */}
                <circle cx={cx} cy={cy - h * 0.55} r={w * 0.42} fill={COLORS.muted} />
                {/* shoulders/body — turned away, so just a rounded slab */}
                <rect
                  x={cx - w / 2}
                  y={cy - h * 0.3}
                  width={w}
                  height={h}
                  rx={w * 0.45}
                  fill={COLORS.muted}
                />
              </g>
            );
          })}
        </svg>
      </AbsoluteFill>

      {/* RIGHT — glowing future */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(135deg, ${hexA(
            COLORS.accent,
            0.16,
          )} 0%, ${hexA(COLORS.accentAlt, 0.12)} 60%, transparent 100%)`,
          clipPath: `polygon(${seam * 100}% 0, 100% 0, 100% 100%, ${
            seam * 100 - 3
          }% 100%)`,
        }}
      >
        <NodeField
          count={46}
          color={COLORS.accent}
          lineColor={COLORS.line}
          opacity={0.9}
          linkDistance={220}
          xRange={[seam + 0.02, 0.99]}
          build={build}
          seedOffset={7}
        />
        {/* rising glow at the base of the future side */}
        <AbsoluteFill
          style={{
            background: `radial-gradient(60% 50% at ${
              seam * 100 + 25
            }% 100%, ${hexA(COLORS.accentAlt, 0.28 * build)} 0%, transparent 70%)`,
          }}
        />
      </AbsoluteFill>

      {/* The seam — a bright vertical light line */}
      <AbsoluteFill>
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${seam * 100}%`,
            width: 3,
            transform: "translateX(-50%) skewX(-1.5deg)",
            background: `linear-gradient(180deg, transparent, ${COLORS.accent}, ${COLORS.accentAlt}, transparent)`,
            boxShadow: `0 0 24px ${hexA(COLORS.accent, 0.8)}`,
            opacity: interpolate(build, [0, 0.3], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
