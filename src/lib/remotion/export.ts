import os from "node:os";

/**
 * How many frames Remotion should paint in parallel.
 *
 * Remotion's own default is roughly half the cores; we leave one core free for
 * Node/ffmpeg and cap at 8 so a big box does not spawn dozens of Chromium
 * tabs. The root remotion.config used to force 1 — that is what made deck
 * downloads crawl.
 */
export function remotionConcurrency(cpus = os.cpus()?.length || 2): number {
  return Math.max(1, Math.min(8, cpus - 1));
}

/**
 * Shared knobs for final Remotion exports (Segment Deck Download MP4, CLI).
 * Full scale, product-matching CRF, jpeg frame buffers for encode speed.
 * Preview/still paths can keep Remotion's lighter defaults; this is the
 * ship-quality path.
 */
export const REMOTION_EXPORT = {
  codec: "h264" as const,
  /** Never downscale a final export. */
  scale: 1,
  /** Matches the app's master encode (`MASTER_CRF` in clipping/encode). */
  crf: 17,
  /** jpeg frame buffers are faster than png; 92 keeps fine text sharp. */
  imageFormat: "jpeg" as const,
  jpegQuality: 92
} as const;
