// Small date helpers built on top of date-fns. Centralized so the rest of the
// progress code never has to think about timezones or week boundaries.

import {
  addDays,
  differenceInCalendarDays,
  endOfWeek,
  format,
  parseISO,
  startOfWeek
} from "date-fns";

// Local calendar day for an ISO timestamp, formatted YYYY-MM-DD.
export function toLocalDateKey(iso: string | Date): string {
  const d = typeof iso === "string" ? parseISO(iso) : iso;
  return format(d, "yyyy-MM-dd");
}

// ISO week key (year + week number), Monday-start weeks.
export function toWeekKey(iso: string | Date): string {
  const d = typeof iso === "string" ? parseISO(iso) : iso;
  const start = startOfWeek(d, { weekStartsOn: 1 });
  return format(start, "yyyy-'W'II");
}

export function weekRangeOf(date: Date) {
  return {
    start: startOfWeek(date, { weekStartsOn: 1 }),
    end: endOfWeek(date, { weekStartsOn: 1 })
  };
}

export function daysBetween(a: string, b: string): number {
  return Math.abs(differenceInCalendarDays(parseISO(a), parseISO(b)));
}

export function nextDay(dateKey: string): string {
  return format(addDays(parseISO(dateKey), 1), "yyyy-MM-dd");
}

export function prettyDate(dateKey: string): string {
  return format(parseISO(dateKey), "EEE MMM d");
}

export function prettyDateTime(iso: string): string {
  return format(parseISO(iso), "MMM d · h:mm a");
}

export function shortWeekdayLabel(dateKey: string): string {
  return format(parseISO(dateKey), "EEE");
}
