import { zonedToUtc } from "@/lib/publisher/time";
import { THREADS_TEXT_LIMIT, type ThreadsAccount, type ThreadsConfig } from "@/lib/threads/config";
import type { ThreadsQueueItem } from "@/lib/threads/types";
import type { XDailyPack, XSuggestedPost } from "@/types/domain";

/**
 * Turns a generated day pack into queue items — pure, so the whole scheduling
 * decision is testable without a filesystem or a network.
 *
 * One item per slot per connected account, each carrying the version of the
 * idea that account posts: the punchy `text` or the warmer `threadsVariant`.
 * Slot times are the pack's wall-clock times read in the configured timezone,
 * plus the account's own offset so two feeds don't fire in lockstep.
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

function textFor(post: XSuggestedPost, account: ThreadsAccount): string {
  return account.posts === "variant" ? post.threadsVariant : post.text;
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
    const slotAt = zonedToUtc(config.timezone, year, month, day, hours ?? 0, minutes ?? 0, 0);

    // The slot is judged by its own time, not each account's offset, so the two
    // accounts always stay in step: a slot is either scheduled for everyone or
    // dropped for everyone.
    if (slotAt.getTime() <= now.getTime()) {
      droppedPastSlots += 1;
      continue;
    }

    for (const account of config.accounts) {
      items.push({
        id: nextId(),
        batchDate: pack.date,
        slot: post.slot,
        accountId: account.id,
        version: account.posts,
        topic: post.topic,
        format: post.format,
        text: fitToThreads(textFor(post, account)),
        publishAt: new Date(slotAt.getTime() + account.offsetMinutes * 60_000).toISOString(),
        status: "pending",
        attempts: 0,
        createdAt
      });
    }
  }

  return { items, droppedPastSlots };
}
