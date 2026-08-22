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

/** Plain-English "this is not a long-form video" for a runtime under the floor. */
export function shortOfLongformNote(durationSec: number): string {
  const minutes = durationSec >= 60 ? `${Math.floor(durationSec / 60)}m ${Math.round(durationSec % 60)}s` : `${Math.round(durationSec)}s`;
  return `At ${minutes} this is not a long-form upload — long-form runs ${MIN_LONGFORM_SEC / 60} minutes or more so it can carry mid-rolls. Post it as a short from the Clip Generator instead.`;
}
