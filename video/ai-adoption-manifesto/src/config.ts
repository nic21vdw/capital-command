/**
 * config.ts — Single source of truth for the Dracula theme tokens,
 * video dimensions, and timing constants.
 *
 * NOTHING in the components should hardcode a hex value or a frame count.
 * Retiming or recoloring the whole video happens here.
 *
 * Dracula palette reference: https://draculatheme.com/contribute
 */

/* ----------------------------------------------------------------------------
 * COLOR TOKENS (Dracula)
 * ------------------------------------------------------------------------- */
export const COLORS = {
  background: "#282A36", // base for every slide
  backgroundDeep: "#1B1C25", // vignette / darker gradient stop
  panel: "#44475A", // cards, subtle fills
  foreground: "#F8F8F2", // primary text
  muted: "#6272A4", // the "resistance" / cold side, silhouettes
  accent: "#BD93F9", // HERO purple — nodes, key text
  accentAlt: "#FF79C6", // pink — impact text, highlights
  line: "#8BE9FD", // cyan — connecting lines, sparing
  growth: "#50FA7B", // green — optional single "growth" pop
  yellow: "#F1FA8C", // used very sparingly for emphasis flashes
} as const;

export type AccentKey = "accent" | "accentAlt" | "line" | "growth";

/* ----------------------------------------------------------------------------
 * GLOW HELPERS — keep glow consistent across every slide.
 * ------------------------------------------------------------------------- */
export const glow = (color: string, strength = 1): string => {
  const s = strength;
  return [
    `0 0 ${8 * s}px ${hexA(color, 0.9)}`,
    `0 0 ${22 * s}px ${hexA(color, 0.65)}`,
    `0 0 ${48 * s}px ${hexA(color, 0.4)}`,
  ].join(", ");
};

export const boxGlow = (color: string, strength = 1): string => {
  const s = strength;
  return [
    `0 0 ${10 * s}px ${hexA(color, 0.7)}`,
    `0 0 ${30 * s}px ${hexA(color, 0.45)}`,
    `0 0 ${70 * s}px ${hexA(color, 0.25)}`,
  ].join(", ");
};

/** Convert a #rrggbb hex + alpha (0-1) to an rgba() string. */
export function hexA(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/* ----------------------------------------------------------------------------
 * TYPOGRAPHY
 * ------------------------------------------------------------------------- */
export const FONT = {
  weightBlack: 800,
  weightBold: 700,
  weightMedium: 500,
  weightRegular: 400,
  letterSpacingTight: "-0.02em",
  letterSpacingWide: "0.14em",
} as const;

/* ----------------------------------------------------------------------------
 * VIDEO
 * ------------------------------------------------------------------------- */
export const VIDEO = {
  width: 1920,
  height: 1080,
  fps: 30,
} as const;

/** Convert seconds to frames at the project fps. */
export const sec = (s: number): number => Math.round(s * VIDEO.fps);

/* ----------------------------------------------------------------------------
 * TIMING CONSTANTS — every slide's length lives here so you can retime the
 * whole video without opening a single component.
 * ------------------------------------------------------------------------- */
export const DURATION_SECONDS = {
  slide01Hook: 9,
  slide02Split: 8,
  slide03Fear: 7,
  slide04Reframe: 7,
  slide05Internet: 9,
  slide06Claim: 7,
  slide07Faster: 7,
  slide08Choice: 8,
  slide09Pivot: 7,
  slide10OnePerson: 8,
  slide11Colateral: 9,
  slide12Enterprise: 8,
  slide13Philosophy: 8,
  slide14Close: 11,
} as const;

/** Frame length of each slide, derived from the seconds map. */
export const DURATION_FRAMES = Object.fromEntries(
  Object.entries(DURATION_SECONDS).map(([k, v]) => [k, sec(v)]),
) as Record<keyof typeof DURATION_SECONDS, number>;

/** Cross-fade length used when stitching slides into the FullVideo. */
export const TRANSITION_FRAMES = sec(0.6);

/* ----------------------------------------------------------------------------
 * BRANDING
 * ------------------------------------------------------------------------- */
export const BRAND = {
  name: "CAPITAL COMMAND",
  product: "CoLateral",
  builtOn: "Built on Fable 5",
} as const;
