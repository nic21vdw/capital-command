/**
 * The line a bulk booking leaves in the run's card ("4 saved as reminders ...")
 * used to live in React state only, so a reload - the natural thing to do after
 * "did that work?" - made it vanish and left nothing saying what had happened.
 * It is kept per clip run (job id) in the browser until it is dismissed, and a
 * different run never shows another run's line.
 *
 * Every access is wrapped: storage can be blocked, full or absent (private
 * windows, previews, tests), and the summary is a convenience, never a gate.
 */

export type BookingSummary = { level: "success" | "warning" | "error"; message: string };

const KEY_PREFIX = "capital-command:uploading-center-booking-summary:";
/** A summary this old describes a week nobody is looking at any more. */
export const BOOKING_SUMMARY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function bookingSummaryKey(jobId: string): string {
  return `${KEY_PREFIX}${jobId}`;
}

export function saveBookingSummary(
  jobId: string,
  summary: BookingSummary,
  now: number = Date.now(),
  storage: StorageLike | null = defaultStorage()
): void {
  if (!storage || !jobId) return;
  try {
    storage.setItem(bookingSummaryKey(jobId), JSON.stringify({ ...summary, savedAt: now }));
  } catch {
    // Quota or blocked storage: the toast and the on-screen line still say it this once.
  }
}

export function loadBookingSummary(
  jobId: string | null | undefined,
  now: number = Date.now(),
  storage: StorageLike | null = defaultStorage()
): BookingSummary | null {
  if (!storage || !jobId) return null;
  try {
    const raw = storage.getItem(bookingSummaryKey(jobId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<BookingSummary> & { savedAt?: unknown };
    const levelOk = value.level === "success" || value.level === "warning" || value.level === "error";
    if (!levelOk || typeof value.message !== "string" || !value.message.trim()) return null;
    if (typeof value.savedAt !== "number" || now - value.savedAt > BOOKING_SUMMARY_TTL_MS) {
      storage.removeItem(bookingSummaryKey(jobId));
      return null;
    }
    return { level: value.level as BookingSummary["level"], message: value.message };
  } catch {
    return null;
  }
}

export function clearBookingSummary(jobId: string | null | undefined, storage: StorageLike | null = defaultStorage()): void {
  if (!storage || !jobId) return;
  try {
    storage.removeItem(bookingSummaryKey(jobId));
  } catch {
    // Nothing to do: it will simply expire.
  }
}
