import { localDateKey } from "@/lib/publisher/schedule";
import type { QueueItem } from "@/lib/publisher/types";

export const DEFAULT_SHORTS_PER_DAY = 2;

export type ShortsDated = Pick<QueueItem, "publishAt"> &
  Partial<Pick<QueueItem, "mediaKind" | "format" | "id" | "clipPath" | "sourceClipPath">>;

export function isShortFormItem(item: Partial<Pick<QueueItem, "mediaKind" | "format">>): boolean {
  return item.mediaKind !== "image" && item.format !== "long";
}

export function shortsLimit(config: { shortsPerDay?: number }): number {
  const limit = config.shortsPerDay;
  return typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_SHORTS_PER_DAY;
}

function normalisePath(value: string): string {
  return value.replace(/\\/g, "/");
}

/**
 * Which video a queue item is a post of. The limit is "never more than two
 * short-form VIDEOS on one day", and one video booked to several platforms is
 * one queue item per platform at the same slot, so the items cannot be counted
 * directly. The key is the clip file; a landscape master that was re-rendered
 * vertical is keyed by the master (`sourceClipPath`), because that is the file
 * a booking names before the render exists. An item with no path stands alone.
 */
export function shortVideoKey(item: Pick<ShortsDated, "id" | "clipPath" | "sourceClipPath">): string | undefined {
  const file = item.sourceClipPath || item.clipPath;
  if (file) return `file:${normalisePath(file)}`;
  return item.id ? `item:${item.id}` : undefined;
}

/** Distinct short-form videos per local day (not queue items: see shortVideoKey). */
export function shortsByDay(items: ShortsDated[], timeZone: string): Map<string, number> {
  const videos = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!isShortFormItem(item)) continue;
    const day = localDateKey(item.publishAt, timeZone);
    const key = shortVideoKey(item);
    if (key !== undefined) {
      const seen = videos.get(day) ?? new Set<string>();
      videos.set(day, seen);
      if (seen.has(key)) continue;
      seen.add(key);
    }
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return counts;
}

/** The days on which this clip already has a short booked. */
function daysHolding(items: ShortsDated[], clipPath: string, timeZone: string): Set<string> {
  const key = shortVideoKey({ clipPath });
  const days = new Set<string>();
  for (const item of items) {
    if (isShortFormItem(item) && shortVideoKey(item) === key) days.add(localDateKey(item.publishAt, timeZone));
  }
  return days;
}

export class ShortsCapError extends Error {
  constructor(
    readonly day: string,
    readonly limit: number
  ) {
    super(
      `${day} already has ${limit} short${limit === 1 ? "" : "s"} booked, which is the daily limit (PUBLISH_SHORTS_PER_DAY). Pick another day.`
    );
    this.name = "ShortsCapError";
  }
}

/**
 * Throws when `publishAt`'s day already holds `limit` shorts. `clipPath` is the
 * video being booked: a day that already holds THAT video has room for it,
 * because another platform of the same video is not another short.
 */
export function assertShortsRoom(
  items: ShortsDated[],
  publishAt: string | Date,
  timeZone: string,
  limit: number,
  clipPath?: string
): void {
  const day = localDateKey(publishAt, timeZone);
  if ((shortsByDay(items, timeZone).get(day) ?? 0) < limit) return;
  if (clipPath && daysHolding(items, clipPath, timeZone).has(day)) return;
  throw new ShortsCapError(day, limit);
}

export function firstSlotWithShortsRoom(
  slots: string[],
  items: ShortsDated[],
  timeZone: string,
  limit: number,
  clipPath?: string
): string | undefined {
  const counts = shortsByDay(items, timeZone);
  const holding = clipPath ? daysHolding(items, clipPath, timeZone) : new Set<string>();
  return slots.find((slot) => {
    const day = localDateKey(slot, timeZone);
    return (counts.get(day) ?? 0) < limit || holding.has(day);
  });
}

export function movesBreachShortsCap(
  items: QueueItem[],
  moves: { id: string; to: string }[],
  timeZone: string,
  limit: number
): boolean {
  const before = shortsByDay(items, timeZone);
  const target = new Map(moves.map((move) => [move.id, move.to]));
  const after = shortsByDay(
    items.map((item) => (target.has(item.id) ? { ...item, publishAt: target.get(item.id)! } : item)),
    timeZone
  );
  for (const [day, count] of after) {
    if (count > limit && count > (before.get(day) ?? 0)) return true;
  }
  return false;
}
