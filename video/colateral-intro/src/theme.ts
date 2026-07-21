/**
 * CoLateral intro palette — clean, premium, on WHITE. Brand colour is the
 * purple gradient from the app icon (`src/app/icon.svg`, #a855f7 → #7c3aed).
 * These B-roll clips are meant to be dropped over/behind a talking-head intro,
 * so everything sits on a bright white stage.
 */
export const theme = {
  bg: "#ffffff", // white stage (requested)
  brandLight: "#a855f7", // gradient top — matches icon.svg
  brandDark: "#7c3aed", // gradient bottom — matches icon.svg
  brand: "#8b3cf0", // flat mid-purple for single-colour fills
  deep: "#3b0764", // deepest purple — pupils, mouth, accents
  ink: "#1e1b2e", // near-black wordmark text
  blush: "#f0abfc", // soft pink cheek blush
  grid: "#ece7f6", // faint blueprint grid line on white
} as const;

/** Friendly, bold, rounded stack (Poppins/Archivo feel) with safe fallbacks. */
export const fontFamily =
  '"Poppins", "Archivo", "Segoe UI", system-ui, -apple-system, sans-serif';

export const VIDEO = { width: 1920, height: 1080, fps: 30 } as const;
