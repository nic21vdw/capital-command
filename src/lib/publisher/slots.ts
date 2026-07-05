import { zonedToUtc } from "@/lib/publisher/time";

/**
 * The Uploading Center's schedule grid: weekdays at fixed local times
 * (default 07:30 / 12:30 / 19:30 in PUBLISH_TIMEZONE), generated for the next
 * N days. Slots are computed on the server so the wall-clock labels are in
 * the configured timezone and the stored instant is UTC, with DST handled by
 * zonedToUtc (07:30 Toronto is 12:30Z in winter but 11:30Z in summer).
 */

export const DEFAULT_SLOT_TIMES = ["07:30", "12:30", "19:30"];

export type ScheduleSlot = {
  /** Stable id: `<dateKey> <time>` in the configured timezone. */
  id: string;
  /** Local calendar date, YYYY-MM-DD. */
  dateKey: string;
  /** Ready-to-render label like "Mon, Jul 6". */
  dateLabel: string;
  /** Local wall-clock time, HH:mm. */
  time: string;
  /** The slot instant as UTC ISO-8601 — what publishAt stores. */
  utc: string;
  /** Already in the past at generation time (render disabled). */
  past: boolean;
};

export type SlotOptions = {
  timeZone: string;
  days?: number;
  now?: Date;
  times?: string[];
  weekdaysOnly?: boolean;
};

/** Calendar date parts of `instant` as observed in `timeZone`. */
function localDateParts(instant: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(instant)) {
    parts[part.type] = part.value;
  }
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

export function generateSlots(options: SlotOptions): ScheduleSlot[] {
  const { timeZone, days = 14, now = new Date(), times = DEFAULT_SLOT_TIMES, weekdaysOnly = true } = options;
  const today = localDateParts(now, timeZone);
  const slots: ScheduleSlot[] = [];

  for (let offset = 0; offset < days; offset += 1) {
    // Date.UTC normalizes day overflow, giving clean calendar arithmetic; the
    // result is only used for its calendar fields, never as an instant.
    const calendarDay = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const weekday = calendarDay.getUTCDay();
    if (weekdaysOnly && (weekday === 0 || weekday === 6)) continue;
    const dateKey = calendarDay.toISOString().slice(0, 10);
    const dateLabel = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric"
    }).format(calendarDay);

    for (const time of times) {
      const [hour, minute] = time.split(":").map(Number);
      const utc = zonedToUtc(
        timeZone,
        calendarDay.getUTCFullYear(),
        calendarDay.getUTCMonth() + 1,
        calendarDay.getUTCDate(),
        hour,
        minute,
        0
      );
      slots.push({
        id: `${dateKey} ${time}`,
        dateKey,
        dateLabel,
        time,
        utc: utc.toISOString(),
        past: utc.getTime() <= now.getTime()
      });
    }
  }
  return slots;
}
