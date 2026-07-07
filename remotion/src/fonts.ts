/**
 * fonts.ts — Loads Inter from @remotion/google-fonts.
 *
 * We only request the weights the design actually uses (400/500/700/800) and
 * the latin subset, which keeps render-time network requests to a minimum.
 * A robust CSS fallback stack means the video still renders cleanly even if
 * the font can't be fetched in a locked-down environment.
 */
import { loadFont } from "@remotion/google-fonts/Inter";

const FALLBACK =
  "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

let family = FALLBACK;

try {
  const { fontFamily } = loadFont("normal", {
    weights: ["400", "500", "700", "800"],
    subsets: ["latin"],
    ignoreTooManyRequestsWarning: true,
  });
  family = `${fontFamily}, ${FALLBACK}`;
} catch {
  // Keep the fallback stack; the render must never fail on a font fetch.
  family = FALLBACK;
}

export const FONT_FAMILY = family;
