import { dateTimeFormat } from "@/lib/publisher/intl";
import { EARLIEST_PUBLISH_DAY_OFFSET } from "@/lib/publisher/schedule";
import { zonedToUtc } from "@/lib/publisher/time";

/**
 * The Uploading Center's schedule grid: every day at fixed local times
 * (weekdays default 07:30 / 12:30 / 19:30, weekends 10:00 / 13:00 / 19:00 in
 * PUBLISH_TIMEZONE), generated for an N-day window that starts today by
 * default or `startDayOffset` days later (how the Uploading Center pages
 * forward through future two-week periods). Slots are
 * computed on the server so the wall-clock labels are in the configured
 * timezone and the stored instant is UTC, with DST handled by zonedToUtc
 * (07:30 Toronto is 12:30Z in winter but 11:30Z in summer).
 */

/**
 * Six a day, matching `youtube.dailyUploadBudget` — the grid and the uploader's
 * own allowance now agree. It was three, which is what made a full queue report
 * "every slot in the next four months is taken" while the channel itself had no
 * such limit. The original three times are still in the set, so nothing already
 * booked sits off-grid. Override with PUBLISH_SLOT_TIMES.
 */
export const DEFAULT_SLOT_TIMES = ["07:30", "10:00", "12:30", "15:30", "19:30", "22:00"];
/** Weekends start later and run later; the original three are kept. */
export const DEFAULT_WEEKEND_SLOT_TIMES = ["08:30", "10:00", "13:00", "15:30", "19:00", "21:00"];

/**
 * How far ahead the booking sheet may reach. A year, not four months: the only
 * thing this bounds is how long a list of empty slots gets, and stopping short
 * of the queue's own reach is what refused work there was room for.
 */
export const DEFAULT_BOOKING_HORIZON_DAYS = 365;

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
  /** Falls on today's local calendar date (render highlighted). */
  today: boolean;
  /**
   * Something may actually be booked here: still to come AND not today. Every
   * picker and the booking plan filter on this rather than on `past`, because
   * today's remaining slots are off limits (see `schedule.ts`). Today's slots
   * are still GENERATED — the board shows the day, and what is already on it.
   */
  bookable: boolean;
};

export type SlotOptions = {
  timeZone: string;
  days?: number;
  /** First day of the window, in days after today (0 = today). */
  startDayOffset?: number;
  now?: Date;
  times?: string[];
  weekendTimes?: string[];
};

/** Calendar date parts of `instant` as observed in `timeZone`. */
function localDateParts(instant: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts: Record<string, string> = {};
  for (const part of dateTimeFormat("en-CA", {
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
  const {
    timeZone,
    days = 14,
    startDayOffset = 0,
    now = new Date(),
    times = DEFAULT_SLOT_TIMES,
    weekendTimes = DEFAULT_WEEKEND_SLOT_TIMES
  } = options;
  const today = localDateParts(now, timeZone);
  const slots: ScheduleSlot[] = [];

  for (let offset = startDayOffset; offset < startDayOffset + days; offset += 1) {
    // Date.UTC normalizes day overflow, giving clean calendar arithmetic; the
    // result is only used for its calendar fields, never as an instant.
    const calendarDay = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const weekday = calendarDay.getUTCDay();
    const dayTimes = weekday === 0 || weekday === 6 ? weekendTimes : times;
    const dateKey = calendarDay.toISOString().slice(0, 10);
    const dateLabel = dateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric"
    }).format(calendarDay);

    for (const time of dayTimes) {
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
      const past = utc.getTime() <= now.getTime();
      slots.push({
        id: `${dateKey} ${time}`,
        dateKey,
        dateLabel,
        time,
        utc: utc.toISOString(),
        past,
        today: offset === 0,
        bookable: !past && offset >= EARLIEST_PUBLISH_DAY_OFFSET
      });
    }
  }
  return slots;
}

/**
 * The soonest slot anything may be booked into — tomorrow's first, in practice.
 * Callers that used to schedule "n minutes from now" (the export auto-enqueue)
 * land here instead of being refused, so a finished render still gets a place.
 */
export function nextBookableSlot(options: Omit<SlotOptions, "days" | "startDayOffset">): ScheduleSlot {
  const slots = generateSlots({ ...options, days: 8 }).filter((slot) => slot.bookable);
  if (slots.length === 0) {
    // Only reachable if a caller passes an empty `times` list; the grid always
    // has slots on tomorrow otherwise.
    throw new Error("No bookable slot in the next week — check the schedule slot times.");
  }
  return slots[0];
}

/**
 * The configured grid as `generateSlots` options. One helper so every caller —
 * the booking sheet, the shuffle, the API and the Uploading Center — draws the
 * same day. A caller that spreads over different times than the picker shows is
 * how a booking lands where nothing can see it.
 */
export function slotGrid(config: { slotTimes: string[]; weekendSlotTimes: string[] }): {
  times: string[];
  weekendTimes: string[];
} {
  return { times: config.slotTimes, weekendTimes: config.weekendSlotTimes };
}
