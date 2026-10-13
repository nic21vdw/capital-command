import type { ThreadsQueueItem } from "@/lib/threads/types";

/** The calendar day after a YYYY-MM-DD key, with no time zone involved. */
export function nextDayKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, (month ?? 1) - 1, (day ?? 1) + 1)).toISOString().slice(0, 10);
}

/**
 * Tomorrow's autopilot batch, when the evening tick has already written it.
 * `posts` is the number of distinct slots, not rows: two accounts posting two
 * versions of each idea is still one post per slot to Nic. Hand-added and
 * stream posts (origin "pipeline") do not make a batch.
 */
export function tomorrowReady(
  items: Pick<ThreadsQueueItem, "batchDate" | "slot" | "origin">[] | undefined,
  todayKey: string
): { date: string; posts: number } | null {
  const date = nextDayKey(todayKey);
  const slots = new Set((items ?? []).filter((item) => item.batchDate === date && item.origin !== "pipeline").map((item) => item.slot));
  return slots.size ? { date, posts: slots.size } : null;
}
