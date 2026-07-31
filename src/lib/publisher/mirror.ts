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

  for (const platform of targets) {
    const usable = PUBLIC_ONLY.includes(platform) ? publishable : schedule;

    if (mode === "match") {
      for (const item of usable) {
        if (item.platforms[platform]) continue;
        plan.additions.push({ itemId: item.id, platform });
      }
      continue;
    }

    // Shuffle: the slots stay put, the clips move between them. Slots this
    // platform already occupies are left alone, and their clips are taken out
    // of the pool so nothing gets scheduled twice.
    const taken = new Set(
      items
        .filter((item) => item.platforms[platform] && new Date(item.publishAt).getTime() > options.now.getTime())
        .map((item) => item.publishAt)
    );
    const openSlots = usable.filter((item) => !taken.has(item.publishAt));
    const pool = shuffled(
      openSlots.map((item) => item.id),
      seedFor(platform, seed)
    );
    openSlots.forEach((slot, index) => {
      plan.newItems.push({
        sourceItemId: pool[index],
        slotItemId: slot.id,
        publishAt: slot.publishAt,
        platform
      });
    });
  }

  return plan;
}

/** One-line summary of what a plan would do, for the CLI and the report. */
export function describeMirrorPlan(plan: MirrorPlan): string {
  const byPlatform = new Map<PlatformId, number>();
  for (const add of plan.additions) byPlatform.set(add.platform, (byPlatform.get(add.platform) ?? 0) + 1);
  for (const item of plan.newItems) byPlatform.set(item.platform, (byPlatform.get(item.platform) ?? 0) + 1);
  const parts = [...byPlatform.entries()].map(([platform, count]) => `${platform} +${count}`);
  return parts.length > 0 ? parts.join(", ") : "nothing to mirror";
}
