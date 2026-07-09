/**
 * "Signal" theme — single source of truth for the Free AI Builds series.
 * Swap the palette here and every scene/component updates globally.
 */
import { loadFont } from "@remotion/google-fonts/Poppins";

// Poppins: bold, geometric, slightly rounded sans — loaded once at module scope
// so every composition and the <Player> share one registration.
const { fontFamily } = loadFont("normal", {
  weights: ["400", "500", "600", "700", "800", "900"],
  subsets: ["latin"]
});

export const FONT_FAMILY = fontFamily;

// ---- Signal palette ----
export const COLOR_BG = "#0f0f0f"; // near-black background
export const COLOR_PRIMARY = "#FF4B1F"; // warm orange-red — primary accent
export const COLOR_SECONDARY = "#FFD23F"; // warm yellow — highlights / CTAs ONLY
export const COLOR_TEXT = "#FAFAFA"; // off-white body/heading text
export const COLOR_REVEAL = "#3DDC84"; // green — RESERVED for reveal/payoff only
export const COLOR_MUTED = "#9AA0A6"; // muted gray — subtitles / secondary text
export const COLOR_BLACK = "#000000"; // cold-open fade-from-black start

/**
 * Translucent variant of any hex palette colour — keeps glows/scrims sourced
 * from the theme instead of hardcoding rgba() per component.
 */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Font weights, named so components never guess.
export const WEIGHT = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900
} as const;

// Vertical YouTube format.
export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 30
} as const;
