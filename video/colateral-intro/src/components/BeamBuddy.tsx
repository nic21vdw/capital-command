import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { theme } from "../theme";

/**
 * Beam Buddy — CoLateral's mascot. A friendly structural I-beam (top flange,
 * web, bottom flange — the steel cross-section) with a face on the web, little
 * arms and feet. Rendered in the brand purple gradient so it reads on white.
 *
 * The character is self-animating: a gentle idle bob, a periodic blink and a
 * soft arm sway, all driven off the composition frame. Position, scale and any
 * entrance transform are the PARENT's job — wrap this in a positioned/animated
 * <div>. An optional `waveFrom` frame triggers a one-off friendly wave.
 */
export const BeamBuddy: React.FC<{
  /** Rendered height in px (aspect ratio is preserved). */
  size?: number;
  /** Frame at which Buddy raises a hand and waves once. Omit for no wave. */
  waveFrom?: number;
  /** Phase offset so multiple Buddies (or reused scenes) don't blink in sync. */
  phase?: number;
}> = ({ size = 300, waveFrom, phase = 0 }) => {
  const frame = useCurrentFrame() + phase;
  const { fps } = useVideoConfig();

  // --- idle bob: a slow ~2s vertical float ---
  const bob = Math.sin((frame / fps) * Math.PI * 1.1) * 6;

  // --- blink: eyes squash shut for ~4 frames every ~2.6s ---
  const blinkPhase = frame % 78;
  const blink = blinkPhase < 4 ? interpolate(blinkPhase, [0, 2, 4], [1, 0.1, 1]) : 1;

  // --- arm sway (idle) + optional one-off wave gesture ---
  const idleSway = Math.sin((frame / fps) * Math.PI * 1.6) * 4;
  let waveAngle = idleSway;
  if (waveFrom != null && frame >= waveFrom) {
    const w = frame - waveFrom;
    // three quick waggles that damp out over ~24 frames
    const waggle = Math.sin(w * 0.9) * 26 * Math.max(0, 1 - w / 24);
    const raise = interpolate(w, [0, 6, 22, 30], [0, -34, -34, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    waveAngle = raise + waggle;
  }

  return (
    <svg
      width={size}
      height={size * (250 / 220)}
      viewBox="0 0 220 250"
      role="img"
      aria-label="Beam Buddy — CoLateral mascot"
      style={{ overflow: "visible", transform: `translateY(${bob}px)` }}
    >
      <defs>
        <linearGradient id="bb-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={theme.brandLight} />
          <stop offset="1" stopColor={theme.brandDark} />
        </linearGradient>
        <filter id="bb-shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="12" stdDeviation="14" floodColor={theme.brandDark} floodOpacity="0.28" />
        </filter>
      </defs>

      {/* little feet peeking below the base flange */}
      <ellipse cx={78} cy={232} rx={21} ry={11} fill={theme.brandDark} />
      <ellipse cx={142} cy={232} rx={21} ry={11} fill={theme.brandDark} />

      <g filter="url(#bb-shadow)">
        {/* left arm (idle) */}
        <g transform={`rotate(${-idleSway} 74 132)`}>
          <rect x={34} y={125} width={42} height={15} rx={7.5} fill="url(#bb-body)" />
        </g>
        {/* right arm (waves) — rotates about its shoulder joint */}
        <g transform={`rotate(${waveAngle} 146 132)`}>
          <rect x={144} y={125} width={42} height={15} rx={7.5} fill="url(#bb-body)" />
        </g>

        {/* ===== the I-beam body ===== */}
        {/* top flange */}
        <rect x={20} y={24} width={180} height={34} rx={15} fill="url(#bb-body)" />
        {/* web (vertical) */}
        <rect x={72} y={50} width={76} height={150} rx={14} fill="url(#bb-body)" />
        {/* bottom flange */}
        <rect x={20} y={192} width={180} height={34} rx={15} fill="url(#bb-body)" />

        {/* glossy highlight on the top flange */}
        <ellipse cx={66} cy={35} rx={40} ry={7} fill="#ffffff" opacity={0.22} />
      </g>

      {/* ===== face (on the web) ===== */}
      {/* cheeks */}
      <circle cx={80} cy={128} r={7} fill={theme.blush} opacity={0.6} />
      <circle cx={140} cy={128} r={7} fill={theme.blush} opacity={0.6} />

      {/* eyes — scaleY drives the blink, pivoting on eye centre (y=108) */}
      <g transform={`translate(0 108) scale(1 ${blink}) translate(0 -108)`}>
        <circle cx={92} cy={108} r={15} fill="#ffffff" />
        <circle cx={128} cy={108} r={15} fill="#ffffff" />
        <circle cx={94} cy={110} r={7} fill={theme.deep} />
        <circle cx={130} cy={110} r={7} fill={theme.deep} />
        {/* catchlights */}
        <circle cx={90} cy={106} r={2.6} fill="#ffffff" />
        <circle cx={126} cy={106} r={2.6} fill="#ffffff" />
      </g>

      {/* smile */}
      <path
        d="M 96 130 Q 110 147 124 130"
        stroke={theme.deep}
        strokeWidth={5}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
};
