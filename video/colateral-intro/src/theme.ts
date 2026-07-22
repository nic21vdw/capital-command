/**
 * CoLateral intro palette — clean, premium, on WHITE, in the CoLateral BLUE.
 * Matches the brand wordmark: "Co" reads near-black navy, "Lateral" the vivid
 * brand blue. Beam Buddy is a pixel-art structural I-beam in the same blue,
 * wearing a white hard hat. These B-roll clips drop over/behind a talking-head
 * intro, so everything sits on a bright white stage.
 */
export const theme = {
  bg: "#ffffff", // white stage (requested)
  brandLight: "#4d97ff", // lighter blue — gradients / glows
  brandDark: "#1655c8", // deeper blue — gradient bottom / shading
  brand: "#1f6fe6", // the "Lateral" blue — primary brand fill
  deep: "#0b3a86", // deepest blue — pupils, mouth, accents
  ink: "#0f1b2d", // near-black navy — the "Co" wordmark text
  blush: "#8fbdf7", // soft blue cheek blush
  grid: "#d6e6fb", // faint blueprint grid line (blue-tinted) on white
  sky: "#eaf2ff", // pale blue tint — blueprint fill / speech bubbles
  hat: "#f6f9ff", // hard-hat white
  hatShade: "#c4d9f4", // hard-hat shading / underside
} as const;

/** Friendly, bold, rounded stack (Poppins/Archivo feel) with safe fallbacks. */
export const fontFamily =
  '"Poppins", "Archivo", "Segoe UI", system-ui, -apple-system, sans-serif';

/** Chunky pixel/console stack for the 8-bit kicker labels. */
export const pixelFontFamily =
  '"Press Start 2P", "Courier New", ui-monospace, monospace';

export const VIDEO = { width: 1920, height: 1080, fps: 30 } as const;
