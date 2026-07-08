import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts, SAFE_MARGIN, type, withAlpha } from "../theme";

const W = 1920;
const H = 1080;

// The column stays perfectly straight until the load crosses this frame
// (~first third of the 180-frame comp), then bows into an Euler S-curve.
const THRESHOLD = 60;
const LOAD_START = 6;
const LOAD_END = 174;

/**
 * A single pin-ended column. An axial load arrow grows; a side gauge fills.
 * When the load passes the critical value the column snaps into a second-mode
 * Euler S-curve (cubic bezier with control points animated to opposite sides)
 * and a red glow blooms at the buckle bellies.
 */
export const BucklingDiagram: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Column geometry.
  const cx = 720;
  const top = 170;
  const bot = 880;
  const h = bot - top;

  // Load grows linearly (this is the applied load P). Deflection is sprung.
  const loadProgress = interpolate(frame, [LOAD_START, LOAD_END], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const pcrFrac = (THRESHOLD - LOAD_START) / (LOAD_END - LOAD_START);

  // Deflection: zero before THRESHOLD (spring on a negative frame is 0), then
  // eases out to the maximum S-curve amplitude.
  const buckle = spring({ frame: frame - THRESHOLD, fps, config: { damping: 14, mass: 1.1 }, durationInFrames: 90 });
  const offset = buckle * 150; // lateral amplitude of the S
  const unstable = frame >= THRESHOLD;

  // Second-mode S-curve: control point 1 to the right, control point 2 to the
  // left, so the column bows one way up top and the other way at the bottom.
  const c1x = cx + offset;
  const c2x = cx - offset;
  const columnPath = `M ${cx} ${top} C ${c1x} ${top + h * 0.28}, ${c2x} ${top + h * 0.72}, ${cx} ${bot}`;

  // Bulge points (where curvature/stress peaks) — glow anchors.
  const bulgeUp = { x: cx + offset * 0.62, y: top + h * 0.3 };
  const bulgeDn = { x: cx - offset * 0.62, y: top + h * 0.7 };

  // Growing axial load arrow above the column.
  const arrowLen = interpolate(loadProgress, [0, 1], [70, 260]);
  const arrowTop = top - 40 - arrowLen;

  // Gauge on the right.
  const gaugeX = 1440;
  const gaugeY = top;
  const gaugeH = h;
  const gaugeW = 46;
  const fillH = loadProgress * gaugeH;
  const pcrY = gaugeY + gaugeH * (1 - pcrFrac);
  const gaugeColor = unstable ? colors.red : colors.pink;

  return (
    <AbsoluteFill style={{ fontFamily: fonts.family }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <marker id="load-head" markerWidth="14" markerHeight="14" refX="7" refY="7" orient="auto">
            <path d="M2,2 L12,7 L2,12 Z" fill={unstable ? colors.red : colors.pink} />
          </marker>
          <radialGradient id="buckle-bloom">
            <stop offset="0%" stopColor={withAlpha("red", 0.9 * buckle)} />
            <stop offset="100%" stopColor={withAlpha("red", 0)} />
          </radialGradient>
        </defs>

        {/* pin supports top & bottom */}
        <circle cx={cx} cy={top} r={14} fill={colors.comment} />
        <circle cx={cx} cy={bot} r={14} fill={colors.comment} />
        <rect x={cx - 130} y={bot + 14} width={260} height={16} rx={4} fill={colors.comment} />

        {/* growing axial load arrow */}
        <line
          x1={cx}
          y1={arrowTop}
          x2={cx}
          y2={top - 30}
          stroke={unstable ? colors.red : colors.pink}
          strokeWidth={10}
          markerEnd="url(#load-head)"
        />

        {/* red glow bellies once unstable */}
        <circle cx={bulgeUp.x} cy={bulgeUp.y} r={130} fill="url(#buckle-bloom)" />
        <circle cx={bulgeDn.x} cy={bulgeDn.y} r={130} fill="url(#buckle-bloom)" />

        {/* the column */}
        <path
          d={columnPath}
          stroke={colors.purple}
          strokeWidth={28}
          strokeLinecap="round"
          fill="none"
          style={{ filter: `drop-shadow(0 0 ${26 * buckle}px ${withAlpha("red", 0.75)})` }}
        />

        {/* ---- load gauge ---- */}
        <rect x={gaugeX} y={gaugeY} width={gaugeW} height={gaugeH} rx={10} fill={colors.surface} />
        <rect
          x={gaugeX}
          y={gaugeY + gaugeH - fillH}
          width={gaugeW}
          height={fillH}
          rx={10}
          fill={gaugeColor}
          style={{ filter: `drop-shadow(0 0 ${16 * loadProgress}px ${withAlpha("pink", 0.5)})` }}
        />
        {/* critical-load line */}
        <line
          x1={gaugeX - 24}
          y1={pcrY}
          x2={gaugeX + gaugeW + 150}
          y2={pcrY}
          stroke={colors.red}
          strokeWidth={4}
          strokeDasharray="14 10"
        />
      </svg>

      {/* labels (HTML for crisp text) */}
      <div
        style={{
          position: "absolute",
          left: cx - 90,
          top: 40,
          fontSize: type.subheading,
          fontWeight: fonts.weight.black,
          color: unstable ? colors.red : colors.pink
        }}
      >
        P
      </div>

      <div
        style={{
          position: "absolute",
          left: gaugeX + gaugeW + 24,
          top: pcrY - 44,
          fontSize: type.label,
          fontWeight: fonts.weight.black,
          color: colors.red,
          letterSpacing: 1
        }}
      >
        P<sub style={{ fontSize: type.caption }}>cr</sub> — critical load
      </div>

      {/* status readout */}
      <div
        style={{
          position: "absolute",
          top: SAFE_MARGIN,
          left: SAFE_MARGIN,
          fontSize: type.heading,
          fontWeight: fonts.weight.black,
          color: colors.foreground,
          maxWidth: 620
        }}
      >
        Euler Buckling
        <div
          style={{
            marginTop: 14,
            fontSize: type.subheading,
            fontWeight: fonts.weight.black,
            color: unstable ? colors.red : colors.green,
            transition: "none"
          }}
        >
          {unstable ? "P > Pcr · UNSTABLE" : "P < Pcr · STABLE"}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: SAFE_MARGIN,
          left: SAFE_MARGIN,
          right: SAFE_MARGIN,
          textAlign: "center",
          fontSize: type.body,
          fontWeight: fonts.weight.semibold,
          color: colors.comment
        }}
      >
        Straight and stable — until the axial load crosses{" "}
        <span style={{ color: colors.red, fontWeight: fonts.weight.black }}>P&#8202;cr</span>. Then it bows, fast.
      </div>
    </AbsoluteFill>
  );
};
