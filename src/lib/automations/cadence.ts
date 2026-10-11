import type { PublisherConfig } from "@/lib/publisher/config";
import type { ThreadsConfig } from "@/lib/threads/config";
import type { CadenceRow } from "@/lib/automations/types";
import { windowClock } from "@/lib/threads/packCadence";
import { formatClockTime } from "@/lib/timeFormat";

/**
 * What changing Threads posts per day does, read off the planner. `threadsConfig()`
 * is read on every tick, and a day already on the queue is never re-planned
 * (`planTodaysBatch`), so lowering it leaves every queued post alone. RAISING it
 * is different: `catchUpToday` counts a day short of the new target and, after
 * its cooldown, re-lays the day's unsent posts across the hours left. Published
 * posts keep their slots. So the note must not promise more than that.
 */
export const THREADS_POSTS_NOTE = "Applies from the next batch the autopilot plans (tomorrow's is written from the evening). Lowering it never moves posts already queued.";

/** Shown while editing, when the new number is higher than the current one. */
export const THREADS_POSTS_RAISE_NOTE = "Raising it can make the autopilot re-space the rest of today's unsent posts to fit the extra ones. Posts already published stay.";

/** Slot times are stored as "HH:mm"; the screen says them the way every other screen does ("6:00 PM"). */
function times(list: string[]): string {
  return list.length ? list.map(formatClockTime).join(", ") : "none";
}

/**
 * The posting rhythm, read from the same config the schedulers use, with the
 * .env name behind each value (shown only under "Advanced"). The four marked
 * `editable` (shorts per day, Threads posts per day and the two slot lists) can
 * be changed from the card; the rest stay in .env because they reshape batches
 * that are already laid out.
 */
export function buildCadence(publisher: PublisherConfig, threads: ThreadsConfig, window: { start: number; span: number }): CadenceRow[] {
  const accounts = threads.accounts.length;
  return [
    { label: "Weekday slots", value: times(publisher.slotTimes), env: "PUBLISH_SLOT_TIMES", editable: true, note: "Monday to Friday, local time." },
    { label: "Weekend slots", value: times(publisher.weekendSlotTimes), env: "PUBLISH_WEEKEND_SLOT_TIMES", editable: true, note: "Saturday and Sunday, local time." },
    { label: "Shorts per day", value: String(publisher.shortsPerDay), env: "PUBLISH_SHORTS_PER_DAY", editable: true, note: "The most a new booking may put on one day." },
    { label: "Time zone", value: publisher.timezone, env: "PUBLISH_TIMEZONE", note: "Slot times and \"today\" for bookings." },
    { label: "Booking reach", value: `${publisher.bookingHorizonDays} days ahead`, env: "PUBLISH_BOOKING_HORIZON_DAYS" },
    { label: "Threads posts per day", value: `${threads.postsPerDay}${accounts > 1 ? ` per account (${accounts} accounts)` : ""}`, env: "THREADS_POSTS_PER_DAY", editable: true, note: THREADS_POSTS_NOTE },
    { label: "Threads posting window", value: `${windowClock(window.start)} to ${windowClock(window.start + window.span)}`, env: "THREADS_DAY_START / THREADS_DAY_END", note: "Posts are spread evenly across this window." },
    { label: "Threads time zone", value: threads.timezone, env: "THREADS_TIMEZONE", note: "Falls back to the publishing time zone." },
    { label: "Threads late grace", value: `${threads.lateGraceMinutes} min`, env: "THREADS_LATE_GRACE_MINUTES", note: "A post this late or less still goes out; later than that is skipped or re-spaced." }
  ];
}
