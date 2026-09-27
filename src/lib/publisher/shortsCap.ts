import { localDateKey } from "@/lib/publisher/schedule";
import type { QueueItem } from "@/lib/publisher/types";

export const DEFAULT_SHORTS_PER_DAY = 2;

type Dated = Pick<QueueItem, "publishAt"> & Partial<Pick<QueueItem, "mediaKind" | "format">>;

export function isShortFormItem(item: Partial<Pick<QueueItem, "mediaKind" | "format">>): boolean {
  return item.mediaKind !== "image" && item.format !== "long";
}

export function shortsLimit(config: { shortsPerDay?: number }): number {
  const limit = config.shortsPerDay;
  return typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_SHORTS_PER_DAY;
}

export function shortsByDay(items: Dated[], timeZone: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!isShortFormItem(item)) continue;
    const day = localDateKey(item.publishAt, timeZone);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return counts;
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

export function assertShortsRoom(items: Dated[], publishAt: string | Date, timeZone: string, limit: number): void {
  const day = localDateKey(publishAt, timeZone);
  if ((shortsByDay(items, timeZone).get(day) ?? 0) >= limit) throw new ShortsCapError(day, limit);
}

export function firstSlotWithShortsRoom(
  slots: string[],
  items: Dated[],
  timeZone: string,
  limit: number
): string | undefined {
  const counts = shortsByDay(items, timeZone);
  return slots.find((slot) => (counts.get(localDateKey(slot, timeZone)) ?? 0) < limit);
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
