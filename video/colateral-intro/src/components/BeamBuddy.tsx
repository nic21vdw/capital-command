import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { theme } from "../theme";

/**
 * Beam Buddy — CoLateral's mascot, now in 8-bit pixel art. A friendly
 * structural I-beam (top flange, web, bottom flange — the steel cross-section)
 * wearing a white construction hard hat, rendered as chunky square pixels in
 * the brand blue. Face lives on the web; little arms sway and one waves.
 *
 * The character is self-animating: a gentle idle bob, a periodic blink and a
 * soft arm sway, all driven off the composition frame. Position, scale and any
 * entrance transform are the PARENT's job — wrap this in a positioned/animated
 * <div>. An optional `waveFrom` frame triggers a one-off friendly wave.
 */

// --- pixel silhouette (body + hard hat), 16 cols × 14 rows -----------------
// . transparent · W hat white · S hat shade · L body blue · D body shade · F feet
const MAP = [
  "......WWWW......", // 0  hard-hat dome
  ".....WWWWWW.....", // 1
  ".....WSSSSW.....", // 2  hat band
  "...SSSSSSSSSS...", // 3  hat brim
  ".LLLLLLLLLLLLLL.", // 4  top flange
  ".LLLLLLLLLLLLDD.", // 5
  "....LLLLLLLL....", // 6  web
  "....LLLLLLLL....", // 7
  "....LLLLLLLL....", // 8
  "....LLLLLLLL....", // 9
  "....LLLLLLDD....", // 10
  ".LLLLLLLLLLLLLL.", // 11 bottom flange
  ".LLLLLLLLLLLLDD.", // 12
  "...FF......FF...", // 13 feet
] as const;

const COLS = 16;
const ROWS = MAP.length;

const PIXEL: Record<string, string> = {
  W: theme.hat,
  S: theme.hatShade,
  L: theme.brand,
  D: theme.brandDark,
  F: theme.brandDark,
};

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

  const px = size / ROWS; // one pixel-cell, in screen px
  const w = COLS * px;
  const h = ROWS * px;

  // --- idle bob: a slow ~2s vertical float ---
  const bob = Math.sin((frame / fps) * Math.PI * 1.1) * (px * 0.28);

  // --- blink: eyes shut for ~4 frames every ~2.6s ---
  const blink = frame % 78 < 4;

  // --- arm sway (idle) + optional one-off wave gesture ---
  const idleSway = Math.sin((frame / fps) * Math.PI * 1.6) * 6;
  let waveAngle = idleSway;
  if (waveFrom != null && frame >= waveFrom) {
    const t = frame - waveFrom;
    // three quick waggles that damp out over ~24 frames, on a raised arm
    const waggle = Math.sin(t * 0.9) * 34 * Math.max(0, 1 - t / 24);
    const raise = interpolate(t, [0, 6, 22, 30], [0, -52, -52, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    waveAngle = raise + waggle;
  }

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${COLS} ${ROWS}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Beam Buddy — CoLateral mascot"
      style={{
        overflow: "visible",
        transform: `translateY(${bob}px)`,
        filter: `drop-shadow(0 ${px * 0.5}px 0 rgba(11,58,134,0.18))`,
      }}
    >
      {/* soft ground shadow (kept subtle so it never fights the pixels) */}
      <ellipse cx={COLS / 2} cy={ROWS - 0.1} rx={4.4} ry={0.7} fill={theme.deep} opacity={0.1} />

      {/* body + hat silhouette, pixel by pixel */}
      {MAP.flatMap((row, y) =>
        row.split("").map((c, x) =>
          c === "." ? null : (
            <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={PIXEL[c]} />
          ),
        ),
      )}

      {/* left arm — idle sway about its shoulder */}
      <g transform={`rotate(${-idleSway} 4 8)`}>
        <rect x={1} y={7} width={3} height={2} fill={theme.brand} />
        <rect x={1} y={9} width={3} height={0.9} fill={theme.brandDark} />
      </g>
      {/* right arm — waves; rotates about its shoulder joint */}
      <g transform={`rotate(${waveAngle} 12 8)`}>
        <rect x={12} y={7} width={3} height={2} fill={theme.brand} />
        <rect x={12} y={9} width={3} height={0.9} fill={theme.brandDark} />
      </g>

      {/* ===== face on the web ===== */}
      {blink ? (
        <>
          {/* closed eyes — a happy squint line */}
          <rect x={5} y={8} width={2} height={0.9} fill={theme.deep} />
          <rect x={9} y={8} width={2} height={0.9} fill={theme.deep} />
        </>
      ) : (
        <>
          {/* eye whites */}
          <rect x={5} y={7} width={2} height={2} fill="#ffffff" />
          <rect x={9} y={7} width={2} height={2} fill="#ffffff" />
          {/* pupils (looking gently forward/inward) */}
          <rect x={6} y={8} width={1} height={1} fill={theme.deep} />
          <rect x={9} y={8} width={1} height={1} fill={theme.deep} />
        </>
      )}

      {/* blush cheeks */}
      <rect x={4} y={9} width={1} height={1} fill={theme.blush} opacity={0.7} />
      <rect x={11} y={9} width={1} height={1} fill={theme.blush} opacity={0.7} />

      {/* pixel smile */}
      <rect x={6} y={9} width={1} height={1} fill={theme.deep} />
      <rect x={7} y={10} width={2} height={1} fill={theme.deep} />
      <rect x={9} y={9} width={1} height={1} fill={theme.deep} />
    </svg>
  );
};
