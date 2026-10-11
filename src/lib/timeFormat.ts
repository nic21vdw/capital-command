import { dateTimeFormat } from "@/lib/publisher/intl";

/**
 * The ONE clock the app writes: 12-hour with AM/PM ("6:00 PM"), in the publish
 * time zone (PUBLISH_TIMEZONE, which every surface already passes around).
 *
 * The calendar read "18:00", the Uploading Center "6:00 PM", the carousel
 * reminders "18:00" and some notes "6pm" - four ways of writing one slot. The
 * app's stamps (Automations, Distribution, the Uploading Center, Threads) were
 * already 12-hour, and there is no 12/24-hour setting to honour, so this is the
 * house style and everything else is brought to it. The locale is fixed to
 * en-US on purpose: `undefined` follows the browser, so the same slot read
 * "18:00" on a machine set to en-GB and "6:00 PM" next to it.
 *
 * Leaf module (one import, itself a leaf) so a client component can use it.
 * `<input type="time">` stays 24-hour: that is the browser's own control.
 */

export type SlotInstant = Date | string | number;

function toDate(value: SlotInstant): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Newer ICU puts a narrow no-break space before AM/PM; a plain one wraps and copies like text. */
function plainSpaces(text: string): string {
  return text.replace(/[  ]/g, " ");
}

function format(date: Date, timeZone: string | undefined, options: Intl.DateTimeFormatOptions): string {
  try {
    return plainSpaces(dateTimeFormat("en-US", timeZone ? { ...options, timeZone } : options).format(date));
  } catch {
    // An unknown zone name: read the slot in the viewer's zone rather than throw while drawing a page.
    return plainSpaces(dateTimeFormat("en-US", options).format(date));
  }
}

/** "6:00 PM" - the wall clock of `timeZone` at that instant. Empty for an unreadable date. */
export function formatSlotTime(value: SlotInstant, timeZone?: string): string {
  const date = toDate(value);
  return date ? format(date, timeZone, { hour: "numeric", minute: "2-digit" }) : "";
}

/**
 * "Oct 14, 6:00 PM", or "Tue, Oct 14, 6:00 PM" with `weekday`. Empty for an
 * unreadable date. The year is left out: a slot is always the next few weeks.
 */
export function formatSlotDateTime(value: SlotInstant, timeZone?: string, options: { weekday?: boolean } = {}): string {
  const date = toDate(value);
  if (!date) return "";
  return format(date, timeZone, {
    ...(options.weekday ? { weekday: "short" as const } : {}),
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

/**
 * "6:00 PM" from a wall-clock "HH:mm" that is ALREADY in the right zone (a
 * calendar event's `time`, a schedule slot, a carousel reminder). No zone maths
 * and no Intl, so a slot cannot shift. Anything that is not HH:mm comes back as
 * it was, so a stray label is never blanked.
 */
export function formatClockTime(hhmm: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return hhmm;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return hhmm;
  return `${hours % 12 === 0 ? 12 : hours % 12}:${match[2]} ${hours >= 12 ? "PM" : "AM"}`;
}
