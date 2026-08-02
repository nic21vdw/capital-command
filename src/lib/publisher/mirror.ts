import type { PlatformId, QueueItem } from "@/lib/publisher/types";

/**
 * One schedule, every platform.
 *
 * The calendar is built once on YouTube — that is where slots are picked and
 * where clips get spaced out — and the other platforms follow it rather than
 * keeping schedules of their own. Two ways to follow it:
 *
 *   "match"   the same clip goes out at the same instant everywhere. One
 *             QueueItem already fans out to several platforms, so this only
 *             adds the missing platform states to the items that exist.
 *
 *   "shuffle" every platform keeps the SAME slots but plays the clips in its
 *             own order, so the feeds don't read as carbon copies of each
 *             other. A slot now holds a different clip per platform, which one
 *             item cannot express, so each target platform gets its own items.
 *
 * Both are idempotent: a platform already scheduled at a slot is left exactly
 * as it is, so re-running never doubles a post up.
 */

export type MirrorMode = "match" | "shuffle";

export type MirrorOptions = {
  /** The platform whose schedule everything else copies. */
  lead?: PlatformId;
  targets: PlatformId[];
  mode?: MirrorMode;
  /** Slots at or before this instant are history and are never touched. */
  now: Date;
  /** Fixes the shuffle so a re-run reproduces it (and tests can pin it). */
  seed?: number;
};

/** A platform state added to an item that already exists. */
export type MirrorAddition = { itemId: string; platform: PlatformId };

/** A brand-new item: this clip, this slot, this one platform. */
export type MirrorNewItem = {
  /** The lead item the clip is taken from. */
  sourceItemId: string;
  /** The lead item whose slot is being filled. */
  slotItemId: string;
  publishAt: string;
  platform: PlatformId;
};

export type MirrorPlan = {
  additions: MirrorAddition[];
  newItems: MirrorNewItem[];
  /** Items that cannot be mirrored, and why — surfaced rather than skipped silently. */
  skipped: Array<{ itemId: string; reason: string }>;
};

/**
 * Instagram and Facebook Reels published through the API are always public;
 * their adapters refuse anything else rather than posting it unlisted. Mirror
 * refuses too, at planning time, so a private clip is reported instead of
 * being queued to fail hours later.
 */
const PUBLIC_ONLY: PlatformId[] = ["instagram", "facebook"];

/** Deterministic 32-bit PRNG (mulberry32) so a seeded shuffle is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates over a copy. A derangement isn't forced: with a handful of
 * clips, insisting nothing keeps its original position skews the result more
 * than the occasional coincidence costs.
 */
export function shuffled<T>(list: T[], seed: number): T[] {
  const out = [...list];
  const next = rng(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A stable per-platform seed, so each platform shuffles differently. */
function seedFor(platform: PlatformId, seed: number): number {
  let hash = seed >>> 0;
  for (const char of platform) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return hash || 1;
}

/**
 * Deals each platform its own running order over the same slots, with no slot
 * ever holding the same clip twice across platforms.
 *
 * An independent shuffle per platform is not enough: with a couple of dozen
 * clips a plain permutation lands roughly one clip back in the slot it started
 * in, so the "different order" quietly posts the same clip everywhere at that
 * instant — exactly the thing shuffling is for. So each platform shuffles
 * independently and then repairs collisions by swapping the offending slot
 * with one that can take it, which keeps the order random rather than making
 * it a rotation of the lead's.
 *
 * `reserved[i]` is the clip the lead platform already holds at slot i.
 */
export function dealDistinctOrders(
  clipIds: string[],
  platforms: PlatformId[],
  seed: number,
  reserved: string[] = []
): Map<PlatformId, string[]> {
  const size = clipIds.length;
  const used: Array<Set<string>> = Array.from({ length: size }, (_, i) =>
    reserved[i] ? new Set([reserved[i]]) : new Set<string>()
  );
  const orders = new Map<PlatformId, string[]>();

  for (const platform of platforms) {
    const order = shuffled(clipIds, seedFor(platform, seed));
    for (let i = 0; i < size; i += 1) {
      if (!used[i].has(order[i])) continue;
      for (let step = 1; step < size; step += 1) {
        const j = (i + step) % size;
        if (!used[i].has(order[j]) && !used[j].has(order[i])) {
          [order[i], order[j]] = [order[j], order[i]];
          break;
        }
      }
    }
    order.forEach((clipId, i) => used[i].add(clipId));
    orders.set(platform, order);
  }

  return orders;
}

function isLive(item: QueueItem, platform: PlatformId): boolean {
  const state = item.platforms[platform];
  return Boolean(state) && state!.status !== "failed";
}

/**
 * The lead platform's upcoming schedule, oldest slot first. A slot is "upcoming"
 * by its own publish time, never by how the lead platform is getting on with it,
 * so a YouTube upload that already succeeded still lends its slot to the others.
 */
export function leadSchedule(items: QueueItem[], lead: PlatformId, now: Date): QueueItem[] {
  return items
    .filter((item) => isLive(item, lead) && new Date(item.publishAt).getTime() > now.getTime())
    .sort((a, b) => a.publishAt.localeCompare(b.publishAt));
}

export function planMirror(items: QueueItem[], options: MirrorOptions): MirrorPlan {
  const lead = options.lead ?? "youtube";
  const mode = options.mode ?? "match";
  const seed = options.seed ?? 1;
  const targets = options.targets.filter((platform) => platform !== lead);
  const plan: MirrorPlan = { additions: [], newItems: [], skipped: [] };

  const schedule = leadSchedule(items, lead, options.now);
  const publishable = schedule.filter((item) => {
    if (item.visibility === "public") return true;
    plan.skipped.push({
      itemId: item.id,
      reason: `visibility is "${item.visibility}" — Instagram and Facebook only accept public posts.`
    });
    return false;
  });

  if (mode === "match") {
    for (const platform of targets) {
      const usable = PUBLIC_ONLY.includes(platform) ? publishable : schedule;
      for (const item of usable) {
        if (item.platforms[platform]) continue;
        plan.additions.push({ itemId: item.id, platform });
      }
    }
    return plan;
  }

  // Shuffle: the slots stay put, the clips move between them. Slots a platform
  // already occupies are left alone so a re-run adds nothing, and the orders
  // are dealt together so no instant carries one clip on two platforms.
  const openFor = new Map<PlatformId, QueueItem[]>();
  for (const platform of targets) {
    const usable = PUBLIC_ONLY.includes(platform) ? publishable : schedule;
    const taken = new Set(
      items
        .filter((item) => item.platforms[platform] && new Date(item.publishAt).getTime() > options.now.getTime())
        .map((item) => item.publishAt)
    );
    openFor.set(
      platform,
      usable.filter((item) => !taken.has(item.publishAt))
    );
  }

  // Platforms sharing the same open slots are dealt as one group, which is
  // what lets the deal guarantee distinct clips per instant.
  const groups = new Map<string, PlatformId[]>();
  for (const [platform, slots] of openFor) {
    if (slots.length === 0) continue;
    const key = slots.map((slot) => slot.id).join("|");
    groups.set(key, [...(groups.get(key) ?? []), platform]);
  }

  for (const [, platforms] of groups) {
    const slots = openFor.get(platforms[0])!;
    const clipIds = slots.map((slot) => slot.id);
    const orders = dealDistinctOrders(clipIds, platforms, seed, clipIds);
    for (const platform of platforms) {
      const order = orders.get(platform)!;
      slots.forEach((slot, index) => {
        plan.newItems.push({
          sourceItemId: order[index],
          slotItemId: slot.id,
          publishAt: slot.publishAt,
          platform
        });
      });
    }
  }

  return plan;
}

/**
 * Undoes a mirror: which target platform states can be lifted back off the
 * lead's items. Only ones the runner has never acted on — still pending, never
 * attempted, holding no post or container id. Anything that reached a platform
 * stays, because removing it would lose the record of a real post.
 */
export function planUnmirror(
  items: QueueItem[],
  targets: PlatformId[],
  now: Date
): { removals: MirrorAddition[]; kept: Array<{ itemId: string; platform: PlatformId; reason: string }> } {
  const removals: MirrorAddition[] = [];
  const kept: Array<{ itemId: string; platform: PlatformId; reason: string }> = [];

  for (const item of items) {
    if (new Date(item.publishAt).getTime() <= now.getTime()) continue;
    for (const platform of targets) {
      const state = item.platforms[platform];
      if (!state) continue;
      const started = state.status !== "pending" || state.attempts > 0 || state.postId || state.containerId;
      if (started) {
        kept.push({ itemId: item.id, platform, reason: `already ${state.status}${state.postId ? ` (${state.postId})` : ""}` });
        continue;
      }
      removals.push({ itemId: item.id, platform });
    }
  }

  return { removals, kept };
}

/** One-line summary of what a plan would do, for the CLI and the report. */
export function describeMirrorPlan(plan: MirrorPlan): string {
  const byPlatform = new Map<PlatformId, number>();
  for (const add of plan.additions) byPlatform.set(add.platform, (byPlatform.get(add.platform) ?? 0) + 1);
  for (const item of plan.newItems) byPlatform.set(item.platform, (byPlatform.get(item.platform) ?? 0) + 1);
  const parts = [...byPlatform.entries()].map(([platform, count]) => `${platform} +${count}`);
  return parts.length > 0 ? parts.join(", ") : "nothing to mirror";
}
