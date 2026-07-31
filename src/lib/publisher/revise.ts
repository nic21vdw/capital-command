import { localCalendarParts } from "@/lib/publisher/time";
import {
  ALL_PLATFORMS,
  type PlatformId,
  type PlatformState,
  type PlatformStatus,
  type QueueItem,
  type Visibility
} from "@/lib/publisher/types";

/**
 * Changing your mind about a post that is already on the queue.
 *
 * The Threads autopilot has been able to reschedule, shift a whole day, edit
 * and skip since it shipped; the publish queue could only rename or delete, so
 * moving a clip by an hour meant deleting it and rebuilding the caption. This
 * module is the missing half, and it is pure: every rule is decided from the
 * item alone, so the API route stays a thin shell and the rules are tested
 * without a queue, a network or a clock.
 *
 * The one hard rule: a post that has LEFT THE APP cannot be edited here. Once
 * bytes are with a platform (uploaded), or YouTube holds it for native
 * publishing (scheduled), or it is live (published), changing the local copy
 * would only make the queue lie about the world. Those posts can still be
 * renamed — YouTube's videos.update genuinely renames a live video — and
 * removed. Everything else (pending, failed, manual, skipped) is still ours.
 */

/** Statuses meaning the platform already has it; local edits can't reach them. */
export const LOCKED_STATUSES: PlatformStatus[] = ["uploaded", "scheduled", "published"];

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook"
};

export function isLockedStatus(status: PlatformStatus): boolean {
  return LOCKED_STATUSES.includes(status);
}

/** Which of an item's platforms have passed the point of local editing. */
export function lockedPlatforms(item: QueueItem): PlatformId[] {
  return ALL_PLATFORMS.filter((platform) => {
    const state = item.platforms[platform];
    return state ? isLockedStatus(state.status) : false;
  });
}

/** Which are still the app's to change. */
export function openPlatforms(item: QueueItem): PlatformId[] {
  return ALL_PLATFORMS.filter((platform) => {
    const state = item.platforms[platform];
    return state ? !isLockedStatus(state.status) : false;
  });
}

function labelList(platforms: PlatformId[]): string {
  const labels = platforms.map((platform) => PLATFORM_LABELS[platform]);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * What a caller may change. Every field is optional; an absent field is left
 * alone, which is what lets the UI send only the control the user touched.
 */
export type RevisePatch = {
  title?: string;
  publishAt?: string;
  caption?: string;
  hashtags?: string[];
  visibility?: Visibility;
  accountId?: string;
  /** The full target set, not a delta — absent means "leave the targets alone". */
  platforms?: PlatformId[];
};

/** Fields that describe how/when the post is delivered, rather than its name. */
const DELIVERY_FIELDS: (keyof RevisePatch)[] = ["publishAt", "caption", "hashtags", "visibility", "accountId"];

function touchesDelivery(patch: RevisePatch): boolean {
  return DELIVERY_FIELDS.some((field) => patch[field] !== undefined);
}

export type ReviseContext = {
  /** The platform the target account belongs to, when accountId is changing. */
  accountPlatform?: PlatformId | null;
  /** Platforms with working credentials for the resulting account. */
  configured?: PlatformId[];
};

/**
 * Why this revision must be refused, or null when it may proceed. Written as
 * one message a person can act on — it names the platforms that blocked it and
 * what to do instead, because "409 Conflict" tells a creator nothing.
 */
export function reviseRefusal(item: QueueItem, patch: RevisePatch, context: ReviseContext = {}): string | null {
  const locked = lockedPlatforms(item);

  if (patch.publishAt !== undefined && Number.isNaN(new Date(patch.publishAt).getTime())) {
    return "That isn't a valid publish time.";
  }
  if (patch.title !== undefined && !patch.title.trim()) {
    return "A post needs a title.";
  }

  if (touchesDelivery(patch) && locked.length > 0) {
    return `This post is already on ${labelList(locked)}, so only its title can change here. Remove it and schedule a new one to change when or how it goes out.`;
  }

  if (patch.platforms !== undefined) {
    const next = new Set(patch.platforms);
    if (next.size === 0) return "A post has to go somewhere — keep at least one platform.";

    const removed = (Object.keys(item.platforms) as PlatformId[]).filter((platform) => !next.has(platform));
    const removedLocked = removed.filter((platform) => locked.includes(platform));
    if (removedLocked.length > 0) {
      return `${labelList(removedLocked)} already has this post, so it can't be dropped from the targets. Remove the whole post instead.`;
    }
  }

  // enqueue() refuses to put a post on an account belonging to another
  // platform; a revision must not be able to sneak past that invariant.
  const accountPlatform = context.accountPlatform;
  if (patch.accountId !== undefined && accountPlatform) {
    const targets = patch.platforms ?? (Object.keys(item.platforms) as PlatformId[]);
    const foreign = targets.filter((platform) => platform !== accountPlatform);
    if (foreign.length > 0) {
      return `That account is a ${PLATFORM_LABELS[accountPlatform]} account — it can't take ${labelList(foreign)} posts.`;
    }
  }

  return null;
}

/**
 * The state without its runner gates. A platform that was backed off or
 * half-claimed gets a clean slate when its post moves or stops, or the runner
 * keeps honouring gates set for the schedule it no longer has.
 */
function withoutGates(state: PlatformState): PlatformState {
  const next = { ...state };
  delete next.nextAttemptAt;
  delete next.claimedAt;
  return next;
}

function freshPlatformState(platform: PlatformId, configured: PlatformId[]): PlatformState {
  if (configured.includes(platform)) return { status: "pending", attempts: 0 };
  return {
    status: "manual",
    attempts: 0,
    note: `${PLATFORM_LABELS[platform]} isn't connected for this account yet — post this clip by hand at the scheduled time, or connect the account so future posts publish automatically.`
  };
}

/**
 * The revised item. Pure: clones rather than mutating, so a refused write can
 * never have half-applied. Call reviseRefusal first — this trusts its patch.
 */
export function applyRevision(item: QueueItem, patch: RevisePatch, context: ReviseContext = {}): QueueItem {
  const next: QueueItem = { ...item, platforms: { ...item.platforms } };

  if (patch.title !== undefined) next.title = patch.title.trim();
  if (patch.caption !== undefined) next.caption = patch.caption;
  if (patch.hashtags !== undefined) next.hashtags = patch.hashtags;
  if (patch.visibility !== undefined) next.visibility = patch.visibility;
  if (patch.accountId !== undefined) next.accountId = patch.accountId;

  if (patch.platforms !== undefined) {
    const configured = context.configured ?? [];
    const wanted = new Set(patch.platforms);
    for (const platform of Object.keys(next.platforms) as PlatformId[]) {
      if (!wanted.has(platform)) delete next.platforms[platform];
    }
    for (const platform of patch.platforms) {
      if (!next.platforms[platform]) next.platforms[platform] = freshPlatformState(platform, configured);
    }
  }

  if (patch.publishAt !== undefined) {
    next.publishAt = new Date(patch.publishAt).toISOString();
    for (const platform of Object.keys(next.platforms) as PlatformId[]) {
      const state = next.platforms[platform];
      if (!state || isLockedStatus(state.status)) continue;
      next.platforms[platform] = withoutGates(state);
    }
  }

  return next;
}

/* ------------------------------------------------------------------ */
/* Skip                                                                */
/* ------------------------------------------------------------------ */

/**
 * Taking a post out of the running without deleting it — the queue's answer to
 * the Threads autopilot's skip. The record stays (so the day still shows what
 * was planned, and the clip isn't silently lost) but the runner never touches
 * it again.
 */
export function skipRefusal(item: QueueItem, platforms?: PlatformId[]): string | null {
  const open = openPlatforms(item);
  if (open.length === 0) {
    const locked = lockedPlatforms(item);
    return locked.length > 0
      ? `This post is already on ${labelList(locked)} — there is nothing left to skip.`
      : "This post has no platforms to skip.";
  }
  if (platforms && platforms.length > 0) {
    const unskippable = platforms.filter((platform) => !open.includes(platform));
    if (unskippable.length > 0) {
      return `${labelList(unskippable)} can't be skipped — it isn't waiting to post.`;
    }
  }
  return null;
}

/** Marks the still-open platforms skipped. Pure; call skipRefusal first. */
export function applySkip(item: QueueItem, platforms?: PlatformId[], reason?: string): QueueItem {
  const targets = platforms && platforms.length > 0 ? platforms : openPlatforms(item);
  const next: QueueItem = { ...item, platforms: { ...item.platforms } };
  for (const platform of targets) {
    const state = next.platforms[platform];
    if (!state || isLockedStatus(state.status)) continue;
    next.platforms[platform] = {
      ...withoutGates(state),
      status: "skipped",
      note: reason?.trim() || "Skipped from the Uploading Center — it will not post."
    };
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* Shift a whole day                                                   */
/* ------------------------------------------------------------------ */

/**
 * Whether this post could still be moved. Shared with the UI so the "Shift
 * day" control appears exactly when the shift would do something — the day's
 * own `past` flag means "no slots left to schedule into", which is a different
 * question: a post at 21:45 today sits on a day with no open slots and is
 * still perfectly movable.
 */
export function isMovable(item: QueueItem): boolean {
  if (lockedPlatforms(item).length > 0) return false;
  const open = openPlatforms(item);
  return open.length > 0 && open.some((platform) => item.platforms[platform]?.status !== "skipped");
}

export function moveRefusal(item: QueueItem): string | null {
  if (isMovable(item)) return null;
  const locked = lockedPlatforms(item);
  if (locked.length > 0) return `Already on ${labelList(locked)} — this one can't be moved.`;
  return "Skipped — this one won't post.";
}

export type ShiftResult = {
  /** The items to write back, already moved. */
  moved: QueueItem[];
  /** Items on the day that could not move, with the reason. */
  blocked: { id: string; title: string; reason: string }[];
};

/**
 * Moves every still-movable post of one local day by N minutes — the queue's
 * answer to the autopilot's shiftBatch, for the morning you decide the whole
 * day should run an hour later.
 *
 * A post that has already left the app is reported as blocked rather than
 * skipped in silence: "I moved 4 of 6" is the honest answer, and the two that
 * stayed are exactly the ones the creator needs to know about.
 */
export function shiftDay(
  items: QueueItem[],
  dateKey: string,
  minutes: number,
  timeZone: string
): ShiftResult {
  const moved: QueueItem[] = [];
  const blocked: ShiftResult["blocked"] = [];

  for (const item of items) {
    if (localCalendarParts(item.publishAt, timeZone).dateKey !== dateKey) continue;
    if (!isMovable(item)) {
      const locked = lockedPlatforms(item);
      blocked.push({
        id: item.id,
        title: item.title,
        reason: locked.length > 0 ? `already on ${labelList(locked)}` : "skipped"
      });
      continue;
    }
    const at = new Date(new Date(item.publishAt).getTime() + minutes * 60_000).toISOString();
    moved.push(applyRevision(item, { publishAt: at }));
  }

  return { moved, blocked };
}
