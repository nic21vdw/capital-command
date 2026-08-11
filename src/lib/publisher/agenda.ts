import type { ChannelVideo } from "@/lib/publisher/channelVideos";
import type { ScheduleSlot } from "@/lib/publisher/slots";
import { localCalendarParts } from "@/lib/publisher/time";
import type { QueueItem } from "@/lib/publisher/types";

/**
 * Turns the schedule window into a day-by-day agenda: every scheduled post and
 * every video already on the channel is placed on the day it goes live, at its
 * real wall-clock time — whether or not that time lines up with a slot. So a
 * clip uploaded at 14:30 shows on that day just like one at the 12:30 slot,
 * instead of being banished to a floating list.
 *
 * Each day also exposes the slot times still open for a drop/upload: a slot is
 * "open" only when it's in the future and no entry already sits on it (within a
 * few minutes' tolerance). The three daily slots are therefore just suggested
 * upload targets layered on top of whatever is actually scheduled that day.
 */

/**
 * How close an entry's time must be to a slot to count as filling it — the same
 * 5-minute tolerance the channel-placement grid uses (app uploads hit the slot
 * exactly; YouTube Studio schedules on 15-minute marks).
 */
export const AGENDA_SLOT_TOLERANCE_MS = 5 * 60 * 1000;

/** One item on a day: a queued post (ours) or a video already on the channel. */
export type AgendaEntry =
  | { kind: "queue"; utc: string; time: string; item: QueueItem }
  | { kind: "channel"; utc: string; time: string; video: ChannelVideo };

export type AgendaDay = {
  /** Local calendar date, YYYY-MM-DD. */
  dateKey: string;
  /** Ready-to-render label like "Mon, Jul 6". */
  dateLabel: string;
  /** Falls on today's local calendar date (render highlighted). */
  today: boolean;
  /** Every slot on this day is already in the past (nothing to schedule). */
  past: boolean;
  /** Posts + channel videos on this day, earliest first. */
  entries: AgendaEntry[];
  /** Slot times still open for a drop/upload (future, uncovered), in order. */
  openSlots: ScheduleSlot[];
};

export function buildAgenda(options: {
  slots: ScheduleSlot[];
  /** Queue items for the platform + account this agenda is for. */
  queueItems: QueueItem[];
  /** Videos already on the channel (YouTube only; empty otherwise). */
  channelVideos: ChannelVideo[];
  timeZone: string;
  toleranceMs?: number;
}): AgendaDay[] {
  const { slots, queueItems, channelVideos, timeZone, toleranceMs = AGENDA_SLOT_TOLERANCE_MS } = options;

  // Ordered, unique day skeleton straight from the slot window — the agenda
  // only ever shows days the window covers; anything else is reached by paging.
  const dayOrder: string[] = [];
  const daySlots = new Map<string, ScheduleSlot[]>();
  const dayMeta = new Map<string, { dateLabel: string; today: boolean }>();
  for (const slot of slots) {
    let bucket = daySlots.get(slot.dateKey);
    if (!bucket) {
      bucket = [];
      daySlots.set(slot.dateKey, bucket);
      dayOrder.push(slot.dateKey);
      dayMeta.set(slot.dateKey, { dateLabel: slot.dateLabel, today: false });
    }
    bucket.push(slot);
    if (slot.today) dayMeta.get(slot.dateKey)!.today = true;
  }

  const entriesByDay = new Map<string, AgendaEntry[]>();
  const place = (entry: AgendaEntry, dateKey: string) => {
    if (!daySlots.has(dateKey)) return; // outside the visible window
    let bucket = entriesByDay.get(dateKey);
    if (!bucket) {
      bucket = [];
      entriesByDay.set(dateKey, bucket);
    }
    bucket.push(entry);
  };
  for (const item of queueItems) {
    const { dateKey, time } = localCalendarParts(item.publishAt, timeZone);
    place({ kind: "queue", utc: new Date(item.publishAt).toISOString(), time, item }, dateKey);
  }
  for (const video of channelVideos) {
    const { dateKey, time } = localCalendarParts(video.publishAtUtc, timeZone);
    place({ kind: "channel", utc: new Date(video.publishAtUtc).toISOString(), time, video }, dateKey);
  }

  return dayOrder.map((dateKey) => {
    const slotsForDay = daySlots.get(dateKey)!;
    const entries = (entriesByDay.get(dateKey) ?? []).sort(
      (a, b) => a.utc.localeCompare(b.utc) || a.time.localeCompare(b.time)
    );
    const entryMs = entries.map((entry) => new Date(entry.utc).getTime());
    const openSlots = slotsForDay.filter((slot) => {
      // Not `past`: today's remaining slots are off limits too, so the board
      // never offers a drop target that the booking would then refuse.
      if (!slot.bookable) return false;
      const slotMs = new Date(slot.utc).getTime();
      return !entryMs.some((ms) => Math.abs(ms - slotMs) <= toleranceMs);
    });
    const meta = dayMeta.get(dateKey)!;
    return {
      dateKey,
      dateLabel: meta.dateLabel,
      today: meta.today,
      past: slotsForDay.every((slot) => slot.past),
      entries,
      openSlots
    };
  });
}
