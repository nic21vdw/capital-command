/**
 * "Signal" theme — high-contrast, warm, energetic. Re-declared here so this
 * package is standalone (same palette as `signal-free-ai-builds` and
 * `ai-price-war`, plus one extra "bad" red for the tier-list verdicts).
 *
 * Verdict tones used across this short:
 *   bad    → red      (Gemini)
 *   okay   → yellow    (ChatGPT)
 *   good   → green     (Claude, the $20 move, the payoff beats)
 */
export const theme = {
  bg: "#0f0f0f", // near-black base
  accent: "#FF4B1F", // primary — warm orange-red (energy / urgency)
  highlight: "#FFD23F", // secondary — warm yellow ("okay" tier / CTAs)
  text: "#FAFAFA", // off-white
  reveal: "#3DDC84", // green — "good" tier + payoff beats
  bad: "#FF4B4B", // red — "bad" tier
  muted: "#8a8a8a",
} as const;

// Friendly, bold, rounded stack (Poppins/Archivo feel) with safe fallbacks.
export const fontFamily =
  '"Poppins", "Archivo", "Segoe UI", system-ui, -apple-system, sans-serif';

/** Maps a verdict tone to its palette colour. */
export const toneColor = (tone: "bad" | "okay" | "good"): string =>
  tone === "bad" ? theme.bad : tone === "okay" ? theme.highlight : theme.reveal;
