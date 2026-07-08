/**
 * Dracula-purple design tokens for the "Manhattan Column Buckling Explained"
 * Remotion package. This is the SINGLE SOURCE OF TRUTH for colour — nothing
 * downstream should hardcode a hex value. Derive translucent variants with
 * `withAlpha` so the raw hex only ever lives here.
 */
import { loadFont } from "@remotion/google-fonts/Inter";

// Load Inter at the weights the compositions use. `fontFamily` is what we hand
// to `fontFamily` CSS everywhere; loading here (module scope) means every
// composition and the <Player> in the app share one registration.
const { fontFamily } = loadFont("normal", {
  weights: ["400", "600", "800"],
  subsets: ["latin"]
});

export const colors = {
  background: "#282a36",
  surface: "#21222c",
  purple: "#bd93f9",
  pink: "#ff79c6",
  cyan: "#8be9fd",
  green: "#50fa7b",
  red: "#ff5555",
  foreground: "#f8f8f2",
  comment: "#6272a4"
} as const;

export type ColorToken = keyof typeof colors;

/**
 * Return a translucent rgba() string for a theme colour. Keeps every hex
 * literal inside this file while still allowing glows, scrims and tints.
 */
export function withAlpha(token: ColorToken, alpha: number): string {
  const hex = colors[token].replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Video format — shared by Root registrations and the app <Player>.
export const VIDEO = {
  width: 1920,
  height: 1080,
  fps: 30
} as const;

// Safe area: keep all text/graphics this far from every edge (spec: 80px).
export const SAFE_MARGIN = 80;

export const fonts = {
  family: fontFamily,
  weight: {
    regular: 400,
    semibold: 600,
    black: 800
  }
} as const;

// Type scale (px, authored at 1080p). Reads legibly at full resolution.
export const type = {
  hero: 132,
  title: 96,
  heading: 64,
  subheading: 44,
  body: 34,
  label: 28,
  caption: 26
} as const;

// A soft neutral shadow used on cards/columns. rgb()/rgba() only — no hex.
export const shadow = {
  card: "0 24px 60px rgba(0, 0, 0, 0.45)",
  soft: "0 12px 30px rgba(0, 0, 0, 0.35)"
} as const;
