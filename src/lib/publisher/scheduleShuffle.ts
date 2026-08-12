import { shuffled } from "@/lib/publisher/mirror";
import type { QueueItem } from "@/lib/publisher/types";

export type ShuffleMove = {
  id: string;
  title: string;
  from: string;
  to: string;
};

export type ShufflePlan = {
  moves: ShuffleMove[];
  unchanged: number;
};

export function isUpcomingItem(item: QueueItem, now: Date): boolean {
  return new Date(item.publishAt).getTime() > now.getTime();
}

export function isYoutubeScheduled(item: QueueItem): boolean {
  const youtube = item.platforms?.youtube;
  return Boolean(youtube && youtube.status === "scheduled" && youtube.postId);
}

export function planScheduleShuffle(
  items: QueueItem[],
  now: Date,
  options: { seed?: number; onlyPending?: boolean } = {}
): ShufflePlan {
  const eligible = items.filter((item) => {
    if (!isUpcomingItem(item, now)) return false;
    if (options.onlyPending && isYoutubeScheduled(item)) return false;
    return true;
  });
  const slots = eligible.map((item) => item.publishAt).sort((a, b) => a.localeCompare(b));
  const seed = options.seed ?? Date.now();
  const order = shuffled(eligible, seed);
  const moves: ShuffleMove[] = [];
  let unchanged = 0;
  for (let index = 0; index < order.length; index += 1) {
    const item = order[index];
    const to = slots[index];
    if (item.publishAt === to) {
      unchanged += 1;
      continue;
    }
    moves.push({ id: item.id, title: item.title, from: item.publishAt, to });
  }
  return { moves, unchanged };
}

export function applyScheduleShuffle(items: QueueItem[], plan: ShufflePlan): QueueItem[] {
  const nextTime = new Map(plan.moves.map((move) => [move.id, move.to]));
  return items.map((item) => {
    const to = nextTime.get(item.id);
    return to ? { ...item, publishAt: to } : item;
  });
}
