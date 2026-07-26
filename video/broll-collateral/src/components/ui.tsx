import React from "react";
import { theme, fontFamily, monoFamily } from "../theme";

/**
 * Tiny UI atoms shared by the fake app screens. Everything here is drawn, not
 * imported from the app — the screens have to render inside Remotion's
 * headless Chromium with no Tailwind, no providers, and no data.
 */

/** A rounded grey bar standing in for a line of text. */
export const Bar: React.FC<{
  w: number | string;
  h?: number;
  color?: string;
  radius?: number;
  style?: React.CSSProperties;
}> = ({ w, h = 8, color = "rgba(255,255,255,0.16)", radius, style }) => (
  <div
    style={{
      width: w,
      height: h,
      borderRadius: radius ?? h / 2,
      background: color,
      flexShrink: 0,
      ...style,
    }}
  />
);

/** A pill-shaped status chip. */
export const Chip: React.FC<{
  label: string;
  color?: string;
  size?: number;
  solid?: boolean;
}> = ({ label, color = theme.accent, size = 13, solid = false }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: `${size * 0.32}px ${size * 0.75}px`,
      borderRadius: 999,
      fontFamily,
      fontSize: size,
      fontWeight: 600,
      letterSpacing: 0.1,
      whiteSpace: "nowrap",
      color: solid ? "#04101f" : color,
      background: solid ? color : hexA(color, 0.14),
      border: `1px solid ${hexA(color, solid ? 0 : 0.34)}`,
    }}
  >
    {label}
  </span>
);

/** A card surface with the app's border + subtle top-light gradient. */
export const Card: React.FC<{
  children?: React.ReactNode;
  style?: React.CSSProperties;
  radius?: number;
  accent?: boolean;
}> = ({ children, style, radius = 16, accent = false }) => (
  <div
    style={{
      borderRadius: radius,
      background: `linear-gradient(180deg, ${theme.surface2} 0%, ${theme.surface} 100%)`,
      border: `1px solid ${accent ? hexA(theme.accent, 0.5) : theme.border}`,
      boxShadow: accent ? `0 0 0 3px ${hexA(theme.accent, 0.1)}` : "none",
      overflow: "hidden",
      ...style,
    }}
  >
    {children}
  </div>
);

/** Section label — the small uppercase kicker the app uses above panels. */
export const Kicker: React.FC<{ children: React.ReactNode; color?: string; size?: number }> = ({
  children,
  color = theme.muted,
  size = 11,
}) => (
  <div
    style={{
      fontFamily,
      fontSize: size,
      fontWeight: 600,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color,
    }}
  >
    {children}
  </div>
);

export const Text: React.FC<{
  children: React.ReactNode;
  size?: number;
  weight?: number;
  color?: string;
  mono?: boolean;
  style?: React.CSSProperties;
}> = ({ children, size = 14, weight = 500, color = theme.text, mono = false, style }) => (
  <div
    style={{
      fontFamily: mono ? monoFamily : fontFamily,
      fontSize: size,
      fontWeight: weight,
      color,
      lineHeight: 1.35,
      ...style,
    }}
  >
    {children}
  </div>
);

/** Simple glyph stand-ins — real icon fonts are not available in the render. */
export const Glyph: React.FC<{ kind: GlyphKind; size?: number; color?: string }> = ({
  kind,
  size = 14,
  color = theme.muted,
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    {GLYPHS[kind]}
  </svg>
);

export type GlyphKind = keyof typeof GLYPHS;

const GLYPHS = {
  play: <polygon points="7,4 20,12 7,20" />,
  film: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M2 12h20" />
    </>
  ),
  wand: (
    <>
      <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8l1.4 1.4M17.8 6.2l1.4-1.4M12.2 6.2l-1.4-1.4M3 21l9-9" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 3 3 5-7" />
    </>
  ),
  rocket: (
    <>
      <path d="M4.5 16.5c-1.5 1.3-2 5.5-2 5.5s4.2-.5 5.5-2c.8-.9.8-2.2-.1-3-.8-.8-2.1-.8-3 0z" />
      <path d="M12 15l-3-3a22 22 0 014-9 11.5 11.5 0 018 0 11.5 11.5 0 010 8 22 22 0 01-9 4z" />
    </>
  ),
  sparkle: <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />,
  layers: (
    <>
      <path d="M12 2l9 5-9 5-9-5 9-5z" />
      <path d="M3 12l9 5 9-5M3 17l9 5 9-5" />
    </>
  ),
  check: <path d="M4 12l5 5L20 6" />,
  upload: (
    <>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v4" />
    </>
  ),
  bulb: (
    <>
      <path d="M9 18h6M10 22h4" />
      <path d="M12 2a6 6 0 00-3 11c.6.5 1 1.2 1 2h4c0-.8.4-1.5 1-2a6 6 0 00-3-11z" />
    </>
  ),
} as const;

/** `#rrggbb` + alpha → `rgba(...)`. Accepts already-rgba strings unchanged. */
export function hexA(hex: string, alpha: number) {
  if (!hex.startsWith("#")) return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
