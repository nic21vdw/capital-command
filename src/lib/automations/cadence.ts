import type { PublisherConfig } from "@/lib/publisher/config";
import type { ThreadsConfig } from "@/lib/threads/config";
import type { CadenceRow } from "@/lib/automations/types";

function clock(minutes: number): string {
  if (minutes >= 1440) return "midnight";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function times(list: string[]): string {
  return list.length ? list.join(", ") : "none";
}

/**
 * The posting rhythm, read from the same config the schedulers use, with the
 * .env name that changes each value. Read-only on purpose: the settings are
 * file-based, and showing them is what lets Nic check the rhythm without
 * opening .env.
 */
export function buildCadence(publisher: PublisherConfig, threads: ThreadsConfig, window: { start: number; span: number }): CadenceRow[] {
  const accounts = threads.accounts.length;
  return [
    { label: "Weekday slots", value: times(publisher.slotTimes), env: "PUBLISH_SLOT_TIMES", note: "Monday to Friday, local time." },
    { label: "Weekend slots", value: times(publisher.weekendSlotTimes), env: "PUBLISH_WEEKEND_SLOT_TIMES", note: "Saturday and Sunday, local time." },
    { label: "Shorts per day", value: String(publisher.shortsPerDay), env: "PUBLISH_SHORTS_PER_DAY", note: "The most a new booking may put on one day." },
    { label: "Time zone", value: publisher.timezone, env: "PUBLISH_TIMEZONE", note: "Slot times and \"today\" for bookings." },
    { label: "Booking reach", value: `${publisher.bookingHorizonDays} days ahead`, env: "PUBLISH_BOOKING_HORIZON_DAYS" },
    { label: "Threads posts per day", value: `${threads.postsPerDay}${accounts > 1 ? ` per account (${accounts} accounts)` : ""}`, env: "THREADS_POSTS_PER_DAY" },
    { label: "Threads posting window", value: `${clock(window.start)} to ${clock(window.start + window.span)}`, env: "THREADS_DAY_START / THREADS_DAY_END", note: "Posts are spread evenly across this window." },
    { label: "Threads time zone", value: threads.timezone, env: "THREADS_TIMEZONE", note: "Falls back to PUBLISH_TIMEZONE." },
    { label: "Threads late grace", value: `${threads.lateGraceMinutes} min`, env: "THREADS_LATE_GRACE_MINUTES", note: "A post this late or less still goes out; later than that is skipped or re-spaced." }
  ];
}
