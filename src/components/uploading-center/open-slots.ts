import type { ScheduleSlot } from "@/lib/publisher/slots";

/**
 * A day with six open slots drew six drop targets, each reading "Drop a clip or
 * video / Upload clip", and on a phone a two-week board ran to thousands of
 * pixels of the same row. From this many open slots in a day, a small screen
 * folds them into one line until it is opened.
 */
export const COLLAPSE_OPEN_SLOTS_AT = 2;

/** Whether a day's open slots fold into the one summary row. */
export function shouldCollapseOpenSlots(count: number): boolean {
  return count >= COLLAPSE_OPEN_SLOTS_AT;
}

/**
 * "3 open slots - 7:30 AM, 10:00 AM, 12:30 PM". Past `maxTimes` the rest is a
 * count ("+3 more") so the line stays one line on a phone. Times come in
 * through `formatTime` so the board's own clock format is the one shown.
 */
export function openSlotsSummary(
  slots: Pick<ScheduleSlot, "time">[],
  formatTime: (hhmm: string) => string,
  maxTimes = 3
): string {
  const count = slots.length;
  if (count === 0) return "No open slots";
  const times = slots.slice(0, maxTimes).map((slot) => formatTime(slot.time));
  const more = count > maxTimes ? ` +${count - maxTimes} more` : "";
  return `${count} open slot${count === 1 ? "" : "s"} - ${times.join(", ")}${more}`;
}
