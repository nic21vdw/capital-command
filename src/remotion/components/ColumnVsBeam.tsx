import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts, SAFE_MARGIN, type, withAlpha } from "../theme";

const W = 1920;
const H = 1080;

/**
 * Side-by-side comparison. Left: a column under axial (top-down) load that
 * buckles sideways. Right: a beam under a distributed span load that sags.
 * Caption drives the point home: buckling is a COLUMN failure mode.
 */
export const ColumnVsBeam: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Shared load ramp — grows in, then holds.
  const load = spring({ frame: frame - 24, fps, config: { damping: 200 }, durationInFrames: 90 });

  // --- Column geometry (left) ---
  const cx = 520;
  const colTop = 250;
  const colBot = 780;
  const bow = interpolate(load, [0, 1], [0, 96]); // lateral buckle deflection
  const columnPath = `M ${cx} ${colTop} C ${cx + bow} ${colTop + (colBot - colTop) * 0.33}, ${
    cx + bow
  } ${colTop + (colBot - colTop) * 0.67}, ${cx} ${colBot}`;
  // Buckle glow sits at the belly of the bow (mid-height, deflected point).
  const bellyX = cx + bow * 0.75;
  const bellyY = (colTop + colBot) / 2;
  const platenDrop = interpolate(load, [0, 1], [0, 16]); // top platen presses down a touch

  // --- Beam geometry (right) ---
  const bx0 = 1160;
  const bx1 = 1680;
  const by = 470;
  const sag = interpolate(load, [0, 1], [0, 78]);
  const beamPath = `M ${bx0} ${by} Q ${(bx0 + bx1) / 2} ${by + sag * 2}, ${bx1} ${by}`;
  const nLoadArrows = 6;

  return (
    <AbsoluteFill style={{ fontFamily: fonts.family }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <marker id="arrowPink" markerWidth="12" markerHeight="12" refX="6" refY="6" orient="auto">
            <path d="M2,2 L10,6 L2,10 Z" fill={colors.pink} />
          </marker>
          <marker id="arrowRed" markerWidth="12" markerHeight="12" refX="6" refY="6" orient="auto">
            <path d="M2,2 L10,6 L2,10 Z" fill={colors.red} />
          </marker>
          <radialGradient id="buckleGlow">
            <stop offset="0%" stopColor={withAlpha("red", 0.85 * load)} />
            <stop offset="100%" stopColor={withAlpha("red", 0)} />
          </radialGradient>
        </defs>

        {/* ============ COLUMN (left) ============ */}
        {/* top + bottom platens */}
        <rect x={cx - 120} y={colTop - 26 + platenDrop} width={240} height={16} rx={4} fill={colors.comment} />
        <rect x={cx - 120} y={colBot + 10} width={240} height={16} rx={4} fill={colors.comment} />

        {/* axial load arrows: down onto the top, up into the base */}
        <line
          x1={cx}
          y1={colTop - 150}
          x2={cx}
          y2={colTop - 40 + platenDrop}
          stroke={colors.pink}
          strokeWidth={8}
          markerEnd="url(#arrowPink)"
          opacity={load}
        />
        <line
          x1={cx}
          y1={colBot + 150}
          x2={cx}
          y2={colBot + 40}
          stroke={colors.pink}
          strokeWidth={8}
          markerEnd="url(#arrowPink)"
          opacity={load}
        />

        {/* buckle glow */}
        <circle cx={bellyX} cy={bellyY} r={110} fill="url(#buckleGlow)" />

        {/* the column itself */}
        <path
          d={columnPath}
          stroke={colors.purple}
          strokeWidth={26}
          strokeLinecap="round"
          fill="none"
          style={{ filter: `drop-shadow(0 0 ${18 * load}px ${withAlpha("purple", 0.6)})` }}
        />

        {/* ============ BEAM (right) ============ */}
        {/* distributed load line + arrows */}
        <line x1={bx0} y1={by - 150} x2={bx1} y2={by - 150} stroke={colors.cyan} strokeWidth={6} opacity={load} />
        {Array.from({ length: nLoadArrows }).map((_, i) => {
          const x = bx0 + ((bx1 - bx0) / (nLoadArrows - 1)) * i;
          return (
            <line
              key={i}
              x1={x}
              y1={by - 150}
              x2={x}
              y2={by - 34}
              stroke={colors.cyan}
              strokeWidth={6}
              markerEnd="url(#arrowRed)"
              opacity={load}
            />
          );
        })}

        {/* supports (triangles) at each end */}
        <path d={`M ${bx0} ${by + 26} l -34 60 l 68 0 Z`} fill={colors.comment} />
        <path d={`M ${bx1} ${by + 26} l -34 60 l 68 0 Z`} fill={colors.comment} />

        {/* the beam itself, sagging */}
        <path
          d={beamPath}
          stroke={colors.cyan}
          strokeWidth={24}
          strokeLinecap="round"
          fill="none"
          style={{ filter: `drop-shadow(0 0 ${10 * load}px ${withAlpha("cyan", 0.5)})` }}
        />
      </svg>

      {/* Labels */}
      <div
        style={{
          position: "absolute",
          top: SAFE_MARGIN + 10,
          left: 0,
          width: W / 2,
          textAlign: "center",
          fontSize: type.heading,
          fontWeight: fonts.weight.black,
          color: colors.purple,
          letterSpacing: 4
        }}
      >
        COLUMN
        <div style={{ fontSize: type.label, color: colors.comment, fontWeight: fonts.weight.semibold, letterSpacing: 2 }}>
          axial load · compresses
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: SAFE_MARGIN + 10,
          right: 0,
          width: W / 2,
          textAlign: "center",
          fontSize: type.heading,
          fontWeight: fonts.weight.black,
          color: colors.cyan,
          letterSpacing: 4
        }}
      >
        BEAM
        <div style={{ fontSize: type.label, color: colors.comment, fontWeight: fonts.weight.semibold, letterSpacing: 2 }}>
          span load · bends
        </div>
      </div>

      {/* Caption */}
      <div
        style={{
          position: "absolute",
          bottom: SAFE_MARGIN,
          left: SAFE_MARGIN,
          right: SAFE_MARGIN,
          textAlign: "center",
          fontSize: type.subheading,
          fontWeight: fonts.weight.semibold,
          color: colors.foreground
        }}
      >
        Buckling is a <span style={{ color: colors.purple, fontWeight: fonts.weight.black }}>COLUMN</span> failure mode.
      </div>
    </AbsoluteFill>
  );
};
