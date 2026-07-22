/**
 * All publish times are entered in ONE configured timezone (PUBLISH_TIMEZONE,
 * default America/Toronto) and stored/sent as UTC. Conversion uses the Intl
 * API so there is no timezone-database dependency to install.
 */

/** Offset (ms) of `timeZone` from UTC at the given UTC instant. */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) parts[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - utcMs;
}

/** Interprets naive wall-clock fields as a moment in `timeZone`. */
export function zonedToUtc(
  timeZone: string,
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number
): Date {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  // Two passes converge across DST transitions.
  let offset = tzOffsetMs(naive, timeZone);
  offset = tzOffsetMs(naive - offset, timeZone);
  return new Date(naive - offset);
}

const NAIVE_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Parses a publish time. Accepts:
 *  - naive local datetimes ("2026-07-10T18:30" or "2026-07-10 18:30"),
 *    interpreted in the configured timezone;
 *  - full ISO-8601 with an offset or Z, used as-is.
 * Returns the instant as a Date, or throws with a helpful message.
 */
export function resolvePublishAt(input: string, timeZone: string): Date {
  const trimmed = input.trim();
  const naive = trimmed.match(NAIVE_RE);
  if (naive) {
    return zonedToUtc(
      timeZone,
      Number(naive[1]),
      Number(naive[2]),
      Number(naive[3]),
      Number(naive[4]),
      Number(naive[5]),
      Number(naive[6] ?? 0)
    );
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Could not parse publish time "${input}". Use "YYYY-MM-DDTHH:mm" (interpreted in ${timeZone}) or full ISO-8601 with an offset.`
    );
  }
  return parsed;
}

/**
 * The local calendar date (YYYY-MM-DD) and wall clock (HH:mm) of a UTC instant
 * as observed in `timeZone`. Used to place a post/video on the day it goes live
 * — regardless of whether its time lines up with a schedule slot.
 */
export function localCalendarParts(instant: string | Date, timeZone: string): { dateKey: string; time: string } {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return { dateKey: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** RFC3339 UTC timestamp, the format YouTube's status.publishAt expects. */
export function toRfc3339Utc(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Human-readable rendering in the configured timezone for logs and dry runs. */
export function formatInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false
  }).format(date);
}
