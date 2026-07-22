/**
 * Clip-count bounds and coercion, kept in a dependency-free module so both the
 * server pipeline (analysis, jobs) and the client UI (Clip Generator) can share
 * a single source of truth without the client bundling ffmpeg/node code.
 */

/** Default number of clips to generate when the creator doesn't choose one. */
export const TARGET_CLIP_COUNT = 10;
/** Smallest number of clips a creator may request. */
export const MIN_CLIP_COUNT = 1;
/** Largest number of clips a creator may request from a single source. */
export const MAX_CLIP_COUNT = 50;

/**
 * Coerces a requested clip count into the supported range, falling back to the
 * default when the value is missing or unparseable. Used everywhere a
 * creator-chosen count enters the pipeline (API, jobs, selection).
 */
export function clampClipCount(value: number | undefined | null): number {
  if (value == null || !Number.isFinite(value)) return TARGET_CLIP_COUNT;
  return Math.max(MIN_CLIP_COUNT, Math.min(MAX_CLIP_COUNT, Math.round(value)));
}
