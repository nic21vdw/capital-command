/**
 * B-roll palette — the CoLateral Command UI, on screen.
 *
 * These clips are advertising collateral for the app itself, so the colours
 * are lifted straight from the app's own "midnight" theme tokens in
 * `src/app/globals.css` (background/panel/surface/border/accent). Anything the
 * viewer sees floating in these videos should read as a real screenshot of the
 * product, not a generic dark mockup.
 */
export const theme = {
  /** Stage background, behind the floating screens. */
  bg: "#05070d",
  bgDeep: "#020307",
  /** App chrome surfaces (--panel / --surface / --surface-2). */
  panel: "#0a0e17",
  surface: "#0c1119",
  surface2: "#101726",
  surface3: "#161f31",
  border: "rgba(255, 255, 255, 0.07)",
  borderStrong: "rgba(255, 255, 255, 0.14)",
  text: "#e6ebf5",
  muted: "#8b95ab",
  faint: "rgba(255, 255, 255, 0.28)",
  /** --accent / --accent-strong. */
  accent: "#4f7dff",
  accentStrong: "#6f97ff",
  /** CoLateral brand blue (matches `video/colateral-intro`). */
  brand: "#1f6fe6",
  brandLight: "#4d97ff",
  /** Status / category accents used across the app's charts and chips. */
  mint: "#2fd08a",
  amber: "#f5b544",
  pink: "#f472b6",
  violet: "#a78bfa",
  cyan: "#38d3ee",
} as const;

/** iOS system-font stack, with the fallbacks headless Chromium actually has. */
export const fontFamily =
  '"SF Pro Display", "SF Pro Text", "Inter", "Segoe UI", system-ui, -apple-system, sans-serif';

export const monoFamily =
  'ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", Menlo, Consolas, monospace';

/** Landscape B-roll: drops under a talking head or behind ad copy. */
export const VIDEO = { width: 1920, height: 1080, fps: 30 } as const;

/** Vertical B-roll: Shorts / Reels / TikTok inserts. */
export const VIDEO_VERTICAL = { width: 1080, height: 1920, fps: 30 } as const;

/** Every B-roll clip is exactly 5 seconds so they cut together interchangeably. */
export const CLIP_FRAMES = 150;
