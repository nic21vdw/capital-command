/**
 * "Signal" theme — high-contrast, warm, energetic. Re-declared here so this
 * package is standalone (same palette as `vibe-coding-first-steps`).
 *
 * Tones used across this short:
 *   accent    → orange-red  (revolution energy, the hook)
 *   highlight → yellow      (the "steam / machines" past era)
 *   reveal    → green       (the payoff — the right model, the AI era)
 */
export const theme = {
  bg: "#0f0f0f", // near-black base
  accent: "#FF4B1F", // primary — warm orange-red (energy / urgency)
  highlight: "#FFD23F", // secondary — warm yellow (past era / emphasis)
  text: "#FAFAFA", // off-white
  reveal: "#3DDC84", // green — payoff beats
  bad: "#FF4B4B", // red — reserved (unused wrong-turn beats)
  muted: "#8a8a8a",
} as const;

// Friendly, bold, rounded stack (Poppins/Archivo feel) with safe fallbacks.
export const fontFamily =
  '"Poppins", "Archivo", "Segoe UI", system-ui, -apple-system, sans-serif';
