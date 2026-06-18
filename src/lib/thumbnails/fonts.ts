/**
 * Font catalog for the thumbnail generator.
 *
 * A mix of system fonts (always available) and Google Fonts (loaded at runtime
 * in the browser). Each entry carries the CSS `family` used for the canvas
 * `font` shorthand plus a default `weight`, since display fonts like Anton or
 * Bebas Neue only ship a single weight and would render incorrectly if forced
 * to 900.
 */
export type FontOption = {
  id: string;
  label: string;
  /** Full CSS font-family stack used when drawing to the canvas. */
  stack: string;
  /** Primary family name, used with the CSS Font Loading API. */
  family: string;
  /** Weight to render at. Display fonts usually only have 400. */
  weight: number;
  /**
   * Google Fonts spec (the part after `family=` in the css2 URL). Omitted for
   * system fonts that need no network load.
   */
  google?: string;
};

const SANS = "system-ui, sans-serif";

export const FONT_OPTIONS: FontOption[] = [
  // System fonts — no download required.
  { id: "arial-black", label: "Arial Black (default)", family: "Arial Black", stack: `"Arial Black", "Segoe UI", ${SANS}`, weight: 900 },
  { id: "impact", label: "Impact", family: "Impact", stack: `"Impact", "Haettenschweiler", ${SANS}`, weight: 400 },
  { id: "georgia", label: "Georgia (serif)", family: "Georgia", stack: `Georgia, "Times New Roman", serif`, weight: 700 },
  { id: "courier", label: "Courier (mono)", family: "Courier New", stack: `"Courier New", monospace`, weight: 700 },

  // Google Fonts — bold display faces that read well on thumbnails.
  { id: "anton", label: "Anton", family: "Anton", stack: `"Anton", ${SANS}`, weight: 400, google: "Anton" },
  { id: "bebas-neue", label: "Bebas Neue", family: "Bebas Neue", stack: `"Bebas Neue", ${SANS}`, weight: 400, google: "Bebas+Neue" },
  { id: "oswald", label: "Oswald", family: "Oswald", stack: `"Oswald", ${SANS}`, weight: 700, google: "Oswald:wght@500;700" },
  { id: "montserrat", label: "Montserrat", family: "Montserrat", stack: `"Montserrat", ${SANS}`, weight: 900, google: "Montserrat:wght@800;900" },
  { id: "poppins", label: "Poppins", family: "Poppins", stack: `"Poppins", ${SANS}`, weight: 800, google: "Poppins:wght@700;800" },
  { id: "archivo-black", label: "Archivo Black", family: "Archivo Black", stack: `"Archivo Black", ${SANS}`, weight: 400, google: "Archivo+Black" },
  { id: "roboto-condensed", label: "Roboto Condensed", family: "Roboto Condensed", stack: `"Roboto Condensed", ${SANS}`, weight: 900, google: "Roboto+Condensed:wght@700;900" },
  { id: "teko", label: "Teko", family: "Teko", stack: `"Teko", ${SANS}`, weight: 700, google: "Teko:wght@600;700" },
  { id: "passion-one", label: "Passion One", family: "Passion One", stack: `"Passion One", ${SANS}`, weight: 900, google: "Passion+One:wght@700;900" },
  { id: "fredoka", label: "Fredoka", family: "Fredoka", stack: `"Fredoka", ${SANS}`, weight: 600, google: "Fredoka:wght@500;700" },
  { id: "righteous", label: "Righteous", family: "Righteous", stack: `"Righteous", ${SANS}`, weight: 400, google: "Righteous" },
  { id: "titan-one", label: "Titan One", family: "Titan One", stack: `"Titan One", cursive`, weight: 400, google: "Titan+One" },
  { id: "bangers", label: "Bangers", family: "Bangers", stack: `"Bangers", cursive`, weight: 400, google: "Bangers" },
  { id: "luckiest-guy", label: "Luckiest Guy", family: "Luckiest Guy", stack: `"Luckiest Guy", cursive`, weight: 400, google: "Luckiest+Guy" },
  { id: "permanent-marker", label: "Permanent Marker", family: "Permanent Marker", stack: `"Permanent Marker", cursive`, weight: 400, google: "Permanent+Marker" }
];

export const DEFAULT_FONT_ID = "arial-black";

export function getFont(id: string): FontOption {
  return FONT_OPTIONS.find((font) => font.id === id) ?? FONT_OPTIONS[0];
}

/** A single Google Fonts stylesheet URL that pulls in every networked face. */
export const GOOGLE_FONTS_HREF = `https://fonts.googleapis.com/css2?${FONT_OPTIONS.filter(
  (font) => font.google
)
  .map((font) => `family=${font.google}`)
  .join("&")}&display=swap`;

/**
 * Ensures a font is ready for canvas rendering. The Canvas 2D API silently
 * falls back to a system font if the requested face has not finished loading,
 * so we explicitly wait via the CSS Font Loading API. Resolves immediately for
 * system fonts or when the API is unavailable.
 */
export async function ensureFontLoaded(font: FontOption): Promise<void> {
  if (!font.google || typeof document === "undefined" || !document.fonts) return;
  try {
    await document.fonts.load(`${font.weight} 110px "${font.family}"`);
    await document.fonts.ready;
  } catch {
    // Network/CSP failures just fall back to the system stack — not fatal.
  }
}
