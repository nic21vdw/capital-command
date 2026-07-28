/**
 * CoLateral intro palette — lifted directly from the live front page
 * (`CoLateral-AI/index.html` + `src/components/mascot/beamy.css`) so the B-roll
 * and the product read as one brand.
 *
 * The app is DARK: a near-black blue-grey stage with purple as the accent.
 * The wordmark is "Co" in near-white and "Lateral" in the brand purple. Beamy —
 * the mascot — is a purple pixel-art I-beam in a cream hard hat with a purple
 * "C" badge on the dome.
 */
export const theme = {
  // --- stage / surfaces (index.html :root) ---
  bg: "#070c12", // --bg  page black
  s0: "#0c1219", // --s0  raised surface
  s1: "#111922", // --s1
  s2: "#16212e", // --s2

  // --- text ---
  tx: "#dce7f0", // --tx   body text
  tx2: "#8ca5bc", // --tx2  secondary
  tx3: "#536b82", // --tx3  muted / fine print
  wordmarkInk: "#f7fbff", // .wordmark colour — the "Co"
  tagline: "#c6d7e7", // .tagline colour

  // --- accents (note: the app's --blue token is in fact PURPLE) ---
  brand: "#bd93f9", // --blue    the "Lateral" purple
  indigo: "#b580ff", // --indigo  eyebrow gradient end
  green: "#1ed96b", // --green
  amber: "#f0b429", // --amber

  // --- Beamy sprite palette (beamy.css custom properties) ---
  beamyBody: "#8a5cc9",
  beamyHi: "#b18ee6",
  beamyShadow: "#5a3a8f",
  beamyInk: "#1a1622",
  beamyHat: "#ece6d8",
  beamyHatShade: "#c2bccf",
  beamyAccent: "#5e3a8f",
  beamyGlow: "rgba(185, 139, 250, 0.35)",

  // --- lines ---
  bd: "rgba(255,255,255,.075)", // --bd
  bd2: "rgba(255,255,255,.14)", // --bd2
  grid: "rgba(140, 165, 188, 0.16)", // canvas dot grid
} as const;

/** The front page loads Inter (rsms.me/inter). Match it, with safe fallbacks. */
export const fontFamily =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/** Brand copy, verbatim from the hero so the B-roll never contradicts the site. */
export const copy = {
  eyebrow: "The All-in-One Engineering Workspace",
  tagline: "One reviewable, source-tied workspace for structural engineering teams.",
  trustline: "For qualified structural & building engineers",
} as const;

export const VIDEO = { width: 1920, height: 1080, fps: 30 } as const;
