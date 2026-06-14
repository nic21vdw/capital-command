// Local-date utilities for the Execution dashboard.
//
// Every execution date is handled as a "YYYY-MM-DD" string interpreted in the
// user's *local* timezone. This deliberately avoids `Date.toISOString()` based
// date math, which shifts late-evening (or early-morning) timestamps onto the
// wrong calendar day for anyone east/west of UTC. Because "YYYY-MM-DD" strings
// sort lexicographically in chronological order, plain string comparison is a
// safe ordering primitive throughout the codebase.

export type LocalDate = string; // "YYYY-MM-DD"

/** Format a Date into a local-timezone YYYY-MM-DD string. */
export function toLocalDateString(date: Date): LocalDate {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today's date in the local timezone. */
export function todayLocal(): LocalDate {
  return toLocalDateString(new Date());
}

/**
 * Parse a YYYY-MM-DD string into a local Date anchored at noon. Anchoring at
 * noon (rather than midnight) keeps the calendar day stable across DST
 * transitions, where a midnight anchor can roll backward an hour into the
 * previous day.
 */
export function parseLocalDate(value: LocalDate): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1, 12, 0, 0, 0);
}

/** Add (or subtract) whole days to a local date string. */
export function addDays(value: LocalDate, days: number): LocalDate {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + days);
  return toLocalDateString(date);
}

/**
 * Monday-based week start. JS `getDay()` returns 0=Sun..6=Sat; we remap so that
 * Monday is 0 and Sunday is 6, then subtract to reach Monday.
 */
export function weekStart(value: LocalDate): LocalDate {
  const date = parseLocalDate(value);
  const mondayIndex = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayIndex);
  return toLocalDateString(date);
}

/** Sunday that ends the Monday-based week containing `value`. */
export function weekEnd(value: LocalDate): LocalDate {
  return addDays(weekStart(value), 6);
}

/** Whole-day distance from `start` to `end` (negative if end precedes start). */
export function daysBetween(start: LocalDate, end: LocalDate): number {
  const a = parseLocalDate(start).getTime();
  const b = parseLocalDate(end).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Inclusive list of every local date from `start` to `end`. */
export function eachDay(start: LocalDate, end: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  let cursor = start;
  while (cursor <= end) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** Day-of-week index with Monday=0 .. Sunday=6. */
export function mondayIndex(value: LocalDate): number {
  return (parseLocalDate(value).getDay() + 6) % 7;
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Short weekday label (Mon..Sun) for a local date. */
export function weekdayLabel(value: LocalDate): string {
  return WEEKDAY_LABELS[mondayIndex(value)];
}

/** Human-friendly date, e.g. "June 13, 2026". */
export function formatLongDate(value: LocalDate): string {
  return parseLocalDate(value).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

/** Compact date, e.g. "Jun 13". */
export function formatShortDate(value: LocalDate): string {
  return parseLocalDate(value).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric"
  });
}

/** Range label for a week, e.g. "Jun 9 – Jun 15, 2026". */
export function formatWeekRange(start: LocalDate): string {
  const end = addDays(start, 6);
  const startLabel = parseLocalDate(start).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  const endLabel = parseLocalDate(end).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
  return `${startLabel} – ${endLabel}`;
}
