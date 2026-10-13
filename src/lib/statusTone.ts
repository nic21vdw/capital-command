/**
 * One colour for one meaning, whichever screen says it.
 *
 * The Uploading Center painted "Scheduled" amber (the colour of "needs a look")
 * while the calendar and the Day Summary painted it blue, so a post booked for
 * tomorrow read as a problem on one screen and as fine on the next. The rule:
 *
 *   info     booked and waiting for its slot: scheduled, queued, uploaded
 *   warning  needs a look: overdue, should be live, needs / awaiting connection,
 *            post by hand
 *   danger   it failed
 *   success  it is out: published, posted, live, sent
 *   neutral  anything with no verdict: draft, skipped, planned
 *
 * The tones are `Badge` / `chip` tones, which the theme paints. Every screen
 * that colours a status asks here, by the word it is showing. A new status is
 * ONE line in TONES; an unknown word is neutral, never alarming.
 *
 * Leaf module: no imports, so the client bundle and the server can both use it.
 */

export type StatusTone = "neutral" | "info" | "warning" | "danger" | "success";

/** Keys are the status as `statusKey` writes it: lowercase letters only. */
const TONES: Record<string, StatusTone> = {
  // It is out.
  published: "success",
  posted: "success",
  live: "success",
  sent: "success",
  done: "success",
  complete: "success",
  completed: "success",
  delivered: "success",
  // Booked, waiting for its slot.
  scheduled: "info",
  queued: "info",
  pending: "info",
  uploaded: "info",
  uploading: "info",
  processing: "info",
  postsatslot: "info",
  toinboxatslot: "info",
  // Needs a look.
  overdue: "warning",
  shouldbelive: "warning",
  needsconnection: "warning",
  awaitingconnection: "warning",
  postbyhand: "warning",
  retrytopost: "warning",
  waitingforquota: "warning",
  manual: "warning",
  retrying: "warning",
  inprogress: "warning",
  // It failed.
  failed: "danger",
  error: "danger",
  partlyfailed: "danger",
  dropped: "danger"
};

/** "Should be live", "shouldBeLive" and "should-be-live" are one status. */
function statusKey(status: string): string {
  return status.toLowerCase().replace(/[^a-z]/g, "");
}

/** The tone for a status word as a screen shows it. "Needs YouTube connection" counts as needing a connection. */
export function statusTone(status: string): StatusTone {
  const key = statusKey(status);
  if (/^needs.+connection$/.test(key)) return "warning";
  return TONES[key] ?? "neutral";
}

/**
 * The word for a booked-but-not-yet-posted post. "Queued", "pending" and "still
 * to go" all meant it and read as three different states; the user-facing word
 * is "Scheduled". Code identifiers keep the queue's own names.
 */
export const SCHEDULED_WORD = "Scheduled";

/** What to print for a status word: the booked-but-not-posted ones all say "Scheduled", anything else is left alone. */
export function statusWord(status: string): string {
  const key = statusKey(status);
  return key === "queued" || key === "pending" ? SCHEDULED_WORD : status;
}
