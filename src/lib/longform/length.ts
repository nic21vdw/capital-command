// How long a long-form video has to be to be one.

/**
 * Eight minutes. Below this a YouTube upload cannot carry mid-roll ads, and a
 * forty-second "long-form" video — which the pipeline has actually rendered
 * and booked — is a short wearing the wrong name. Every part of the long-form
 * side measures itself against this: topic segments are planned to clear it,
 * the editor says when an edit is under it, and the scheduler refuses to book
 * one as a long-form upload.
 */
export const MIN_LONGFORM_SEC = 8 * 60;

export function isLongformLength(durationSec: number): boolean {
  return durationSec >= MIN_LONGFORM_SEC;
}

/** A runtime as "8m 05s" — rounding the seconds alone produced "4m 60s". */
export function formatRuntime(durationSec: number): string {
  const whole = Math.round(Math.max(0, durationSec));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

/** Plain-English "this is not a long-form video" for a runtime under the floor. */
export function shortOfLongformNote(durationSec: number): string {
  return `At ${formatRuntime(durationSec)} this is not a long-form upload — long-form runs ${MIN_LONGFORM_SEC / 60} minutes or more so it can carry mid-rolls. Post it as a short from the Clip Generator instead.`;
}

/** A timestamp as YouTube's chapter parser reads it: "1:05", or "1:01:01" past the hour. */
export function formatChapterTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
