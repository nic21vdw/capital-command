import type { ChannelVideo } from "@/lib/publisher/channelVideos";
import type { ScheduleSlot } from "@/lib/publisher/slots";

/**
 * Places the channel's real YouTube schedule onto the Uploading Center grid so
 * a slot that is already spoken for on YouTube can never be double-booked from
 * here. Every channel video lands in exactly one of three buckets:
 *
 *  - `bySlotUtc`   — its go-live time sits on (or within a few minutes of) a
 *                    free grid slot: the video occupies that slot cell.
 *  - `dayMarkers`  — it goes live on a day the grid shows but at some other
 *                    time (a Short scheduled by hand in YouTube Studio at,
 *                    say, 09:00): the day's row gets a marker chip with that
 *                    wall-clock time. Videos whose matching slot is already
 *                    filled by a queue item land here too — that clash is
 *                    exactly what the marker exists to surface.
 *  - `outsideWindow` — it isn't on any day the grid currently shows.
 */

/**
 * How far a video's publishAt may sit from a slot time and still count as
 * that slot. Uploads made from this app hit the slot instant exactly;
 * YouTube Studio schedules on 15-minute marks — so 5 minutes is wide enough
 * to absorb second-level drift and narrow enough that a deliberately
 * different time (even the next quarter-hour) shows as a day marker instead.
 * Grid slots are hours apart, so no video can be within tolerance of two.
 */
export const SLOT_MATCH_TOLERANCE_MS = 5 * 60 * 1000;

/** A channel video that shares a grid day but not a grid slot. */
export type ChannelDayMarker = {
  video: ChannelVideo;
  /** Local wall-clock go-live time, HH:mm in the publish timezone. */
  time: string;
};

export type ChannelPlacement = {
  /** Channel video occupying a grid slot, keyed by the slot's UTC instant. */
  bySlotUtc: Map<string, ChannelVideo>;
  /** Off-slot videos per grid day, keyed by dateKey (YYYY-MM-DD), sorted by time. */
  dayMarkers: Map<string, ChannelDayMarker[]>;
  /** Videos on days the grid doesn't currently show, in input order. */
  outsideWindow: ChannelVideo[];
};

/** Local calendar date (YYYY-MM-DD) and wall clock (HH:mm) of a UTC instant. */
function localDateTime(utcIso: string, timeZone: string): { dateKey: string; time: string } {
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(utcIso))) {
    parts[part.type] = part.value;
  }
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

export function placeChannelVideos(options: {
  videos: ChannelVideo[];
  slots: ScheduleSlot[];
  /** True when a queue item already fills this slot (keyed by slot UTC). */
  isSlotOccupied: (slotUtc: string) => boolean;
  timeZone: string;
  toleranceMs?: number;
}): ChannelPlacement {
  const { videos, slots, isSlotOccupied, timeZone, toleranceMs = SLOT_MATCH_TOLERANCE_MS } = options;
  const gridDays = new Set(slots.map((slot) => slot.dateKey));
  const bySlotUtc = new Map<string, ChannelVideo>();
  const dayMarkers = new Map<string, ChannelDayMarker[]>();
  const outsideWindow: ChannelVideo[] = [];

  for (const video of videos) {
    const videoMs = new Date(video.publishAtUtc).getTime();
    // Nearest slot within tolerance; grid slots are hours apart so at most
    // one can qualify, but nearest keeps ties deterministic regardless.
    let slot: ScheduleSlot | undefined;
    let slotDistance = Infinity;
    for (const candidate of slots) {
      const distance = Math.abs(new Date(candidate.utc).getTime() - videoMs);
      if (distance <= toleranceMs && distance < slotDistance) {
        slot = candidate;
        slotDistance = distance;
      }
    }
    if (slot && !isSlotOccupied(slot.utc) && !bySlotUtc.has(slot.utc)) {
      bySlotUtc.set(slot.utc, video);
      continue;
    }
    const { dateKey, time } = localDateTime(video.publishAtUtc, timeZone);
    if (!gridDays.has(dateKey)) {
      outsideWindow.push(video);
      continue;
    }
    if (!dayMarkers.has(dateKey)) dayMarkers.set(dateKey, []);
    dayMarkers.get(dateKey)!.push({ video, time });
  }

  for (const markers of dayMarkers.values()) markers.sort((a, b) => a.time.localeCompare(b.time));
  return { bySlotUtc, dayMarkers, outsideWindow };
}
