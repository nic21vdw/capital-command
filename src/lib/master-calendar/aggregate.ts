import { dateTimeFormat } from "@/lib/publisher/intl";
import type { AppData, Carousel, ContentItem, FbPost, XDailyPack } from "@/types/domain";
import { isImagePost } from "@/lib/publisher/images";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";
import type { MasterCalendarEvent } from "@/lib/master-calendar/types";

/**
 * Flattens every distribution surface into MasterCalendarEvents for a
 * [startKey, startKey + days) window of local calendar days. Publish-queue
 * instants (UTC) are mapped to calendar days in the configured publish
 * timezone; every other source already stores local YYYY-MM-DD dates and is
 * used as-is.
 */

const DAY_MS = 86_400_000;

const PLATFORM_LABELS: Record<PlatformId, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook"
};

/** Calendar-day arithmetic on YYYY-MM-DD keys via UTC ms (never an instant). */
function parseKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

export function addDaysToKey(key: string, days: number): string {
  return new Date(parseKey(key) + days * DAY_MS).toISOString().slice(0, 10);
}

function weekdayOfKey(key: string): number {
  return new Date(parseKey(key)).getUTCDay();
}

/** Today's calendar date as observed in `timeZone`. en-CA renders YYYY-MM-DD. */
export function todayKeyIn(timeZone: string, now = new Date()): string {
  return dateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** A UTC instant's local calendar date + wall-clock time in `timeZone`. */
function localDateTime(instant: Date, timeZone: string): { dateKey: string; time: string } {
  const parts: Record<string, string> = {};
  for (const part of dateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(instant)) {
    parts[part.type] = part.value;
  }
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`
  };
}

function inRange(dateKey: string, startKey: string, endKeyExclusive: string): boolean {
  return dateKey >= startKey && dateKey < endKeyExclusive;
}

function truncate(text: string, max = 80): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * One overall status for a queue item across its per-platform states:
 * everything landed → published, everything dead → failed, anything already
 * uploaded/natively scheduled → scheduled, otherwise still queued.
 */
function queueItemStatus(item: QueueItem): string {
  const states = Object.values(item.platforms);
  if (states.length > 0 && states.every((state) => state?.status === "published")) return "published";
  if (states.length > 0 && states.every((state) => state?.status === "failed")) return "failed";
  if (states.some((state) => state?.status === "scheduled" || state?.status === "uploaded")) return "scheduled";
  return "queued";
}

function shortsEvents(
  items: QueueItem[],
  timeZone: string,
  startKey: string,
  endKey: string
): MasterCalendarEvent[] {
  const events: MasterCalendarEvent[] = [];
  for (const item of items) {
    const instant = new Date(item.publishAt);
    if (Number.isNaN(instant.getTime())) continue;
    const { dateKey, time } = localDateTime(instant, timeZone);
    if (!inRange(dateKey, startKey, endKey)) continue;
    // A picture post rides the same queue as the shorts but is not one — the
    // calendar filed a booked carousel under Shorts, where he would never look
    // for it.
    const picture = isImagePost(item);
    events.push({
      id: `${picture ? "queued-carousels" : "shorts"}:${item.id}`,
      source: picture ? "queued-carousels" : "shorts",
      dateKey,
      time,
      title: truncate(
        item.title || item.clipPath.split("/").pop() || (picture ? "Scheduled carousel" : "Scheduled short")
      ),
      platforms: (Object.keys(item.platforms) as PlatformId[]).map((platform) => PLATFORM_LABELS[platform]),
      status: queueItemStatus(item)
    });
  }
  return events;
}

/**
 * Carousel upload schedules (PR #203's Carousel.schedules — once/daily/weekly
 * at a wall-clock time, anchored on a start date). Read structurally so this
 * compiles before that branch lands: until the field exists in the storage
 * schema the array is simply absent and carousels contribute no events.
 */
type CarouselScheduleLike = {
  id: string;
  platforms?: string[];
  time?: string;
  recurrence?: "once" | "daily" | "weekly";
  date?: string;
  weekday?: number;
};

function carouselEvents(carousels: Carousel[], startKey: string, endKey: string, days: number): MasterCalendarEvent[] {
  const events: MasterCalendarEvent[] = [];
  for (const carousel of carousels) {
    const schedules = (carousel as Carousel & { schedules?: CarouselScheduleLike[] }).schedules ?? [];
    for (const schedule of schedules) {
      if (!schedule?.date) continue;
      const platforms = (schedule.platforms ?? []).map(
        (platform) => PLATFORM_LABELS[platform as PlatformId] ?? platform
      );
      const base = {
        source: "carousels" as const,
        time: schedule.time,
        title: truncate(carousel.title || "Carousel"),
        platforms,
        status: "scheduled"
      };
      const recurrence = schedule.recurrence ?? "once";
      if (recurrence === "once") {
        if (inRange(schedule.date, startKey, endKey)) {
          events.push({ ...base, id: `carousel:${schedule.id}:${schedule.date}`, dateKey: schedule.date });
        }
        continue;
      }
      const anchorWeekday = schedule.weekday ?? weekdayOfKey(schedule.date);
      for (let offset = 0; offset < days; offset += 1) {
        const dateKey = addDaysToKey(startKey, offset);
        if (dateKey < schedule.date) continue;
        if (recurrence === "weekly" && weekdayOfKey(dateKey) !== anchorWeekday) continue;
        events.push({ ...base, id: `carousel:${schedule.id}:${dateKey}`, dateKey, recurring: true });
      }
    }
  }
  return events;
}

function xEvents(packs: XDailyPack[], startKey: string, endKey: string): MasterCalendarEvent[] {
  const events: MasterCalendarEvent[] = [];
  for (const pack of packs) {
    if (!inRange(pack.date, startKey, endKey)) continue;
    for (const post of pack.posts) {
      events.push({
        id: `x:${pack.id}:${post.id}`,
        source: "x",
        dateKey: pack.date,
        time: post.time,
        title: truncate(post.topic || post.text),
        platforms: ["X", "Threads"],
        status: "suggested"
      });
    }
  }
  return events;
}

function fbEvents(posts: FbPost[], startKey: string, endKey: string): MasterCalendarEvent[] {
  return posts
    .filter((post) => inRange(post.date, startKey, endKey))
    .map((post) => ({
      id: `fb:${post.id}`,
      source: "fb" as const,
      dateKey: post.date,
      title: truncate(post.hook || post.body),
      platforms: [post.platform === "facebook" ? "Facebook" : "Instagram"],
      status: post.status
    }));
}

function contentEvents(items: ContentItem[], startKey: string, endKey: string): MasterCalendarEvent[] {
  const events: MasterCalendarEvent[] = [];
  for (const item of items) {
    const dateKey = item.publishDate?.slice(0, 10);
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !inRange(dateKey, startKey, endKey)) continue;
    const time = item.publishDate?.match(/[T ](\d{2}:\d{2})/)?.[1];
    events.push({
      id: `content:${item.id}`,
      source: "content",
      dateKey,
      time,
      title: truncate(item.title),
      platforms: [item.platform],
      status: item.status.toLowerCase()
    });
  }
  return events;
}

export function buildMasterCalendarEvents(options: {
  data: AppData;
  queueItems: QueueItem[];
  timeZone: string;
  startKey: string;
  days: number;
}): MasterCalendarEvent[] {
  const { data, queueItems, timeZone, startKey, days } = options;
  const endKey = addDaysToKey(startKey, days);

  const events = [
    ...shortsEvents(queueItems, timeZone, startKey, endKey),
    ...carouselEvents(data.videoStudio?.carousels ?? [], startKey, endKey, days),
    ...xEvents(data.xPlanner?.packs ?? [], startKey, endKey),
    ...fbEvents(data.fbStrategy?.posts ?? [], startKey, endKey),
    ...contentEvents(data.contentItems ?? [], startKey, endKey)
  ];

  // Day-level items (no time) first, then chronological — matches how the
  // calendar renders a day: all-day rows above the timed plan.
  return events.sort((a, b) => {
    if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
    if (!a.time || !b.time) return a.time ? 1 : b.time ? -1 : 0;
    return a.time.localeCompare(b.time);
  });
}
