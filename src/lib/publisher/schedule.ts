import { localCalendarParts } from "@/lib/publisher/time";

/**
 * NOTHING IS EVER BOOKED ONTO TODAY.
 *
 * A batch booking used to be free to take whatever slots were left in the day it
 * ran, and YouTube uploads the bytes as soon as the runner sees a pending item
 * (see `queue.duePlatforms`) — so a run booked at breakfast put its whole output
 * on the channel before lunch, tripped YouTube's daily upload limit, and locked
 * the account out of uploading for the rest of the day.
 *
 * So the earliest a post may go out is TOMORROW, in the publish timezone. This
 * is the leaf that says so: `slots.ts` marks a slot unbookable with it, the
 * booking plan and every schedule picker filter on that, and `enqueue()` refuses
 * a same-day time outright — the last of those is the one that actually holds,
 * because a picker can be bypassed and an API caller can name any instant.
 *
 * The rule is about the CALENDAR DAY, not a number of hours: "at least 24 hours
 * from now" would still let a 23:00 booking post tomorrow morning and then a
 * second batch post again tomorrow evening.
 */

/** Days after today the earliest bookable slot falls on. One means tomorrow. */
export const EARLIEST_PUBLISH_DAY_OFFSET = 1;

/** Local calendar date (YYYY-MM-DD) of an instant, as observed in `timeZone`. */
export function localDateKey(instant: string | Date, timeZone: string): string {
  return localCalendarParts(instant, timeZone).dateKey;
}

/** Calendar arithmetic on a YYYY-MM-DD key. UTC is used only to normalize overflow. */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The first local calendar date a post may be scheduled on. */
export function earliestPublishDateKey(now: Date, timeZone: string): string {
  return addDaysToDateKey(localDateKey(now, timeZone), EARLIEST_PUBLISH_DAY_OFFSET);
}

/** True when `publishAt` falls on today (or earlier) in the publish timezone. */
export function isSameDayOrEarlier(publishAt: string | Date, now: Date, timeZone: string): boolean {
  return localDateKey(publishAt, timeZone) < earliestPublishDateKey(now, timeZone);
}

/** Why a time was refused, in the words the UI and the CLI both show. */
export function tooSoonMessage(publishAt: string | Date, now: Date, timeZone: string): string {
  const asked = localDateKey(publishAt, timeZone);
  const earliest = earliestPublishDateKey(now, timeZone);
  const today = localDateKey(now, timeZone);
  return (
    `${asked === today ? "That slot is today" : `That slot (${asked}) has already passed`} — ` +
    `nothing is scheduled for the same day it is booked, so the whole batch cannot land on one day and ` +
    `trip YouTube's daily upload limit. The earliest slot is ${earliest} (${timeZone}).`
  );
}

/** Thrown by `enqueue()` when a caller asks for a slot today or earlier. */
export class TooSoonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TooSoonError";
  }
}

/**
 * The gate every enqueue passes through. `allowSameDay` exists for the one
 * caller that legitimately means now — a person pressing "publish now" on a post
 * that is already on the board — and is never set by anything automatic.
 */
export function assertBookable(
  publishAt: string | Date,
  now: Date,
  timeZone: string,
  options: { allowSameDay?: boolean } = {}
): void {
  if (options.allowSameDay) return;
  if (isSameDayOrEarlier(publishAt, now, timeZone)) {
    throw new TooSoonError(tooSoonMessage(publishAt, now, timeZone));
  }
}
