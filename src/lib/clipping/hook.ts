import type { CaptionSegment } from "@/types/domain";

/**
 * Opening dead air, removed from the rendered short.
 *
 * `leadingSilenceSec` (editor.ts) has always known how long a clip waits
 * before its first word — but only the Uploading Center's PREVIEW acted on
 * it, by seeking past it. The file that actually got posted still opened on
 * the pause. On a feed where the first second decides whether anyone sees
 * the second, that is the most expensive thing a short can do, and it was
 * invisible in the app because every preview hid it.
 *
 * So the ready-to-post render now starts on the word. This module decides how
 * much to cut and keeps that decision honest: a trim that ate a third of the
 * clip, or left a two-second stub, would be a worse bug than the dead air.
 *
 * Leaf module — pure functions over caption times, tested.
 */

/** Never cut more than this fraction of the clip, however long the opening pause is. */
export const MAX_HOOK_TRIM_FRACTION = 0.25;
/** Never leave a short shorter than this once trimmed. */
export const MIN_TRIMMED_CLIP_SEC = 5;
/** Below this, the pause is part of the delivery and cutting it sounds abrupt. */
export const MIN_HOOK_TRIM_SEC = 0.5;

/**
 * How much to cut off the front of a clip whose first word lands `leadSec`
 * in. Returns 0 whenever trimming would be too small to notice or large
 * enough to damage the clip.
 */
export function hookTrimSec(leadSec: number, clipDurationSec: number): number {
  if (!Number.isFinite(leadSec) || !Number.isFinite(clipDurationSec)) return 0;
  if (leadSec < MIN_HOOK_TRIM_SEC || clipDurationSec <= MIN_TRIMMED_CLIP_SEC) return 0;
  const byFraction = clipDurationSec * MAX_HOOK_TRIM_FRACTION;
  const byRemainder = clipDurationSec - MIN_TRIMMED_CLIP_SEC;
  const allowed = Math.min(byFraction, byRemainder);
  if (allowed < MIN_HOOK_TRIM_SEC) return 0;
  const trim = Math.min(leadSec, allowed);
  return trim < MIN_HOOK_TRIM_SEC ? 0 : Number(trim.toFixed(3));
}

/**
 * Slides caption segments (and their words) back by `bySec` so burned-in
 * captions stay in sync with a clip whose front was cut. Segments that fall
 * entirely inside the removed head are dropped; one straddling the cut is
 * clamped to start at 0.
 */
export function shiftSegments(segments: CaptionSegment[], bySec: number): CaptionSegment[] {
  if (bySec <= 0) return segments;
  const shifted: CaptionSegment[] = [];
  for (const segment of segments) {
    const end = segment.end - bySec;
    if (end <= 0) continue;
    const words = segment.words
      .map((word) => ({ ...word, start: word.start - bySec, end: word.end - bySec }))
      .filter((word) => word.end > 0)
      .map((word) => ({ ...word, start: Math.max(0, word.start) }));
    shifted.push({ ...segment, start: Math.max(0, segment.start - bySec), end, words });
  }
  return shifted;
}
