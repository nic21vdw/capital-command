import React from "react";
import { theme } from "../theme";

/**
 * The CoLateral logo mark — the rounded I-beam glyph with a diagonal brace,
 * copied from the `.hero-logo` SVG in `index.html` (and `favicon.svg`).
 *
 * `draw` (0..1) animates it on like a CAD line: the tile fades in, then the
 * flanges and web extend, then the brace strikes through.
 */
export const HeroMark: React.FC<{ size?: number; draw?: number }> = ({
  size = 96,
  draw = 1,
}) => {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  // staggered sub-progress: tile → web → flanges → brace
  const tile = clamp(draw * 4);
  const web = clamp((draw - 0.12) * 3.2);
  const flange = clamp((draw - 0.3) * 3.2);
  const brace = clamp((draw - 0.62) * 2.8);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      role="img"
      aria-label="CoLateral"
      style={{ filter: `drop-shadow(0 0 20px rgba(189,147,249,.45))`, overflow: "visible" }}
    >
      <rect width="40" height="40" rx="10" fill={theme.brand} opacity={0.22 * tile} />
      {/* vertical web, grows down from the top flange */}
      <rect
        x="9"
        y="9"
        width="4.4"
        height={22 * web}
        rx="2.2"
        fill={theme.brand}
      />
      {/* top + bottom flanges, extending right */}
      <rect x="9" y="9" width={20 * flange} height="4.4" rx="2.2" fill={theme.brand} />
      <rect x="9" y="26.6" width={20 * flange} height="4.4" rx="2.2" fill={theme.brand} />
      {/* diagonal brace */}
      <line
        x1="15"
        y1="14"
        x2={15 + 15 * brace}
        y2={14 + 13 * brace}
        stroke={theme.brand}
        strokeWidth="2.6"
        strokeLinecap="round"
        opacity={0.7}
      />
    </svg>
  );
};
