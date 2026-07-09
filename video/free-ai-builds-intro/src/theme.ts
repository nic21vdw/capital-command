/**
 * "Signal" theme — high-contrast, warm, energetic.
 * Built around one bold accent on a clean near-black base so it pops
 * on autoplay and thumbnails without reading as generic tech content.
 */
export const theme = {
  bg: "#0f0f0f", // near-black base
  accent: "#FF4B1F", // primary — warm orange-red (energy / urgency)
  highlight: "#FFD23F", // secondary — warm yellow (CTAs / highlights, used sparingly)
  text: "#FAFAFA", // off-white
  reveal: "#3DDC84", // green — reserved for payoff/reveal beats only
  muted: "#8a8a8a",
} as const;

// Friendly, bold, rounded stack (Poppins/Archivo feel) with safe fallbacks.
export const fontFamily =
  '"Poppins", "Archivo", "Segoe UI", system-ui, -apple-system, sans-serif';
