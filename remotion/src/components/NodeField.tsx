import React, { useMemo } from "react";
import { AbsoluteFill, random, useCurrentFrame, interpolate } from "remotion";
import { COLORS, hexA, VIDEO } from "../config";

interface Node {
  x: number;
  y: number;
  r: number;
  driftX: number;
  driftY: number;
  speed: number;
  seed: number;
}

/**
 * NodeField — a drifting constellation of glowing nodes with connecting lines.
 * Deterministic (seeded via Remotion's `random`) so every render is identical.
 *
 * Used two ways:
 *  - as a low-opacity ambient background behind manifesto slides
 *  - as a foreground "network forming" hero element (higher opacity, more links)
 */
export const NodeField: React.FC<{
  count?: number;
  color?: string;
  lineColor?: string;
  /** 0-1 overall opacity of the whole field. */
  opacity?: number;
  /** Only draw links shorter than this (px) — controls network density. */
  linkDistance?: number;
  /** Restrict nodes to a horizontal band [0-1, 0-1] of the frame. */
  xRange?: [number, number];
  /** 0-1 progress used to "grow" the network in. */
  build?: number;
  seedOffset?: number;
}> = ({
  count = 40,
  color = COLORS.accent,
  lineColor = COLORS.line,
  opacity = 0.35,
  linkDistance = 260,
  xRange = [0, 1],
  build = 1,
  seedOffset = 0,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = VIDEO;

  const nodes: Node[] = useMemo(() => {
    const arr: Node[] = [];
    for (let i = 0; i < count; i++) {
      const s = i + seedOffset * 1000;
      const x0 = xRange[0] + random(`x-${s}`) * (xRange[1] - xRange[0]);
      arr.push({
        x: x0 * width,
        y: random(`y-${s}`) * height,
        r: 2 + random(`r-${s}`) * 4,
        driftX: (random(`dx-${s}`) - 0.5) * 60,
        driftY: (random(`dy-${s}`) - 0.5) * 60,
        speed: 0.4 + random(`sp-${s}`) * 0.8,
        seed: s,
      });
    }
    return arr;
  }, [count, seedOffset, width, height, xRange]);

  // Current positions with gentle sinusoidal drift.
  const positioned = nodes.map((n) => {
    const t = (frame / VIDEO.fps) * n.speed;
    return {
      ...n,
      cx: n.x + Math.sin(t + n.seed) * n.driftX,
      cy: n.y + Math.cos(t * 0.8 + n.seed) * n.driftY,
    };
  });

  // How many nodes are "revealed" by the build progress.
  const revealed = Math.round(interpolate(build, [0, 1], [0, count], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }));

  const links: React.ReactNode[] = [];
  for (let i = 0; i < revealed; i++) {
    for (let j = i + 1; j < revealed; j++) {
      const a = positioned[i];
      const b = positioned[j];
      const dx = a.cx - b.cx;
      const dy = a.cy - b.cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < linkDistance) {
        const strength = 1 - dist / linkDistance;
        links.push(
          <line
            key={`l-${i}-${j}`}
            x1={a.cx}
            y1={a.cy}
            x2={b.cx}
            y2={b.cy}
            stroke={hexA(lineColor, 0.5 * strength)}
            strokeWidth={1}
          />,
        );
      }
    }
  }

  return (
    <AbsoluteFill style={{ opacity }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ position: "absolute", inset: 0 }}
      >
        {links}
        {positioned.slice(0, revealed).map((n, i) => {
          const pulse = 0.6 + 0.4 * Math.sin((frame / VIDEO.fps) * 2 + n.seed);
          return (
            <circle
              key={`n-${i}`}
              cx={n.cx}
              cy={n.cy}
              r={n.r}
              fill={color}
              style={{
                filter: `drop-shadow(0 0 ${6 * pulse}px ${hexA(color, 0.9)})`,
              }}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
