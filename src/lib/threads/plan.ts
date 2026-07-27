import { zonedToUtc } from "@/lib/publisher/time";
import { THREADS_TEXT_LIMIT, type ThreadsConfig } from "@/lib/threads/config";
import type { ThreadsQueueItem } from "@/lib/threads/types";
import type { XDailyPack } from "@/types/domain";

/**
 * Turns a generated day pack into queue items — pure, so the whole scheduling
 * decision is testable without a filesystem or a network.
 *
 * Two posts per slot: the pack's `text` as the top-level post, and its
 * `threadsVariant` either as a reply under it (default) or as its own post a
 * few minutes later. Slot times are the pack's wall-clock times read in the
 * configured timezone.
 *
 * Slots whose time has already passed are dropped, never scheduled into the
 * past. That is what keeps a batch planned at 2pm from firing seven backdated
 * posts at once — the day simply starts from the next open slot.
 */

/** Trims to the Threads limit on a word boundary, without a dangling ellipsis. */
export function fitToThreads(text: string, limit = THREADS_TEXT_LIMIT): string {
  const clean = text.trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

export type PlanBatchInput = {
  pack: XDailyPack;
  config: ThreadsConfig;
  now: Date;
  /** Injected in tests so ids are predictable. */
  newId?: () => string;
};

export type PlanBatchOutput = {
  items: ThreadsQueueItem[];
  /** Slots left out because their time had already passed. */
  droppedPastSlots: number;
};

export function planBatch({ pack, config, now, newId }: PlanBatchInput): PlanBatchOutput {
  const nextId = newId ?? (() => `thread-${crypto.randomUUID()}`);
  const createdAt = now.toISOString();
  const [year, month, day] = pack.date.split("-").map(Number);

  const items: ThreadsQueueItem[] = [];
  let droppedPastSlots = 0;

  for (const post of pack.posts.slice(0, config.postsPerDay)) {
    const [hours, minutes] = post.time.split(":").map(Number);
    const mainAt = zonedToUtc(config.timezone, year, month, day, hours ?? 0, minutes ?? 0, 0);
    if (mainAt.getTime() <= now.getTime()) {
      droppedPastSlots += 1;
      continue;
    }

    const main: ThreadsQueueItem = {
      id: nextId(),
      batchDate: pack.date,
      slot: post.slot,
      role: "main",
      topic: post.topic,
      format: post.format,
      text: fitToThreads(post.text),
      publishAt: mainAt.toISOString(),
      status: "pending",
      attempts: 0,
      createdAt
    };
    items.push(main);

    if (config.secondPost === "off") continue;

    const variantText = fitToThreads(post.threadsVariant);
    // A reworded near-duplicate of the same idea is worth posting under the
    // original, not beside it — the reply keeps the feed clean and turns the
    // slot into an actual thread.
    const variantAt = new Date(mainAt.getTime() + config.secondPostGapMinutes * 60_000);
    items.push({
      id: nextId(),
      batchDate: pack.date,
      slot: post.slot,
      role: "variant",
      topic: post.topic,
      format: post.format,
      text: variantText,
      publishAt: variantAt.toISOString(),
      ...(config.secondPost === "reply" ? { replyToItemId: main.id } : {}),
      status: "pending",
      attempts: 0,
      createdAt
    });
  }

  return { items, droppedPastSlots };
}
