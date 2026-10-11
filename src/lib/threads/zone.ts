import { dateTimeFormat } from "@/lib/publisher/intl";
import { localCalendarParts, resolvePublishAt } from "@/lib/publisher/time";

// Every time on the Threads Autopilot page is a moment in the autopilot's own
// zone (THREADS_TIMEZONE / PUBLISH_TIMEZONE), the same one the cards and the
// Automations page already speak. These helpers are the page's only way to turn
// an instant into words, so a browser set to another zone cannot disagree with
// them. Pure and client-safe.

/** "7:10 PM" in `timeZone`. */
export function threadsClock(iso: string, timeZone: string): string {
  if (!Number.isFinite(Date.parse(iso))) return "unknown";
  return new Intl.DateTimeFormat(undefined, { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** The value a datetime-local input wants, as the wall clock of `timeZone`. */
export function toZonedInput(iso: string, timeZone: string): string {
  const { dateKey, time } = localCalendarParts(iso, timeZone);
  return `${dateKey}T${time}`;
}

/** What a datetime-local value typed on the page means: a wall clock in `timeZone`. Null when it is empty or unreadable. */
export function fromZonedInput(value: string, timeZone: string): Date | null {
  try {
    return resolvePublishAt(value, timeZone);
  } catch {
    return null;
  }
}

/** Today's YYYY-MM-DD in `timeZone`. */
export function zonedDateKey(timeZone: string, now: Date = new Date()): string {
  return localCalendarParts(now, timeZone).dateKey;
}

/** "Toronto" from "America/Toronto". */
function placeName(timeZone: string): string {
  const last = timeZone.split("/").pop() ?? timeZone;
  return last.replace(/_/g, " ");
}

/**
 * "Times in Toronto time (EDT)" - but only when the browser is somewhere else.
 * When the two agree the page needs no caveat, and null keeps it quiet.
 */
export function zoneNote(timeZone: string, browserZone: string | null | undefined, now: Date = new Date()): string | null {
  if (!browserZone || browserZone === timeZone) return null;
  let abbreviation = "";
  try {
    abbreviation = dateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return null;
  }
  return `Times in ${placeName(timeZone)} time${abbreviation ? ` (${abbreviation})` : ""}`;
}

/** The browser's own zone, or null where Intl cannot say. */
export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
