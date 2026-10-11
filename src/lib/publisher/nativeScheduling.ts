import { usesTiktokInbox } from "@/lib/publisher/tiktokInbox";
import { youtubeHoldsForReview } from "@/lib/publisher/reviewHold";
import type { PlatformId, PlatformState, QueueItem } from "@/lib/publisher/types";

/**
 * Which platforms take a post BEFORE its time and publish it themselves.
 *
 * This is the difference between a post that is really booked and one that is
 * only written down here. YouTube accepts the upload the moment it is queued
 * with status.publishAt set, so the video sits in YouTube Studio as Scheduled
 * and goes live without this app being awake. Facebook does the same for a
 * Reel and for a picture post, within a window of its own (below). Instagram
 * and TikTok have no scheduling in their publishing APIs at all — for those
 * two the runner IS the scheduler, and it posts at the slot.
 *
 * The queue's due rule and the board's wording both read this, so a platform
 * that gains native scheduling changes behaviour and copy from one line.
 */
export const PRE_SCHEDULES: Record<PlatformId, boolean> = {
  youtube: true,
  instagram: false,
  tiktok: false,
  facebook: true
};

export function preSchedules(platform: PlatformId): boolean {
  return PRE_SCHEDULES[platform];
}

/**
 * Facebook's own limits on a scheduled post: `scheduled_publish_time` is taken
 * only when it is "greater than 10 minutes from the current time and within 29
 * days of the current date". The Reels finish call and a Page feed post read
 * the same window, so one pair of edges covers both.
 *
 * Both edges are pulled in from the documented ones on purpose. The floor is
 * 15 minutes because the media is handed over BEFORE the call that carries the
 * time — for a Reel: start, transfer, then poll until Facebook has the bytes;
 * for a deck: one unpublished photo upload per slide — so a post handed over
 * with eleven minutes to spare can reach that call with nine. The ceiling is 28
 * days because the queue is a year deep and an item sitting a day inside the
 * real edge would tip over it between the run that picked it up and the run
 * that finishes it.
 */
export const FACEBOOK_SCHEDULE_MIN_MS = 15 * 60_000;
export const FACEBOOK_SCHEDULE_MAX_MS = 28 * 24 * 60 * 60_000;

export type FacebookLead = "too-far" | "schedulable" | "at-the-slot";

/**
 * Where a Facebook post sits relative to that window. "at-the-slot" covers
 * everything from a quarter of an hour out to long overdue: too close to
 * schedule, so it is simply posted, which is what this app did for Facebook
 * before scheduling existed.
 */
export function facebookLead(publishAt: string, now: Date): FacebookLead {
  const lead = new Date(publishAt).getTime() - now.getTime();
  if (lead > FACEBOOK_SCHEDULE_MAX_MS) return "too-far";
  if (lead >= FACEBOOK_SCHEDULE_MIN_MS) return "schedulable";
  return "at-the-slot";
}

/** Minutes until a too-far post enters the window Facebook will accept. */
export function facebookScheduleWaitMinutes(publishAt: string, now: Date): number {
  const lead = new Date(publishAt).getTime() - now.getTime();
  return Math.max(1, Math.ceil((lead - FACEBOOK_SCHEDULE_MAX_MS) / 60_000));
}

/**
 * Whether THIS post can be handed to THIS platform ahead of its slot.
 *
 * Facebook is the reason this takes the item and not just the platform. Both
 * shapes it posts can be scheduled — a Reel through the finish call, a picture
 * post through `published=false` with `scheduled_publish_time` — but only
 * inside the window above. A post booked four months out is not schedulable
 * yet, and calling it due would hand it over now with nothing to hold it back.
 */
export function preSchedulesItem(
  platform: PlatformId,
  item: Pick<QueueItem, "mediaKind" | "publishAt">,
  now: Date = new Date()
): boolean {
  if (platform !== "facebook") return PRE_SCHEDULES[platform];
  return facebookLead(item.publishAt, now) === "schedulable";
}

/** What the board knows beyond the post itself. */
export type PendingContext = {
  /**
   * YouTube's upload allowance for today is spent, so a YouTube post that has
   * not gone up yet is waiting for the quota to reset rather than "uploading".
   * The runner leaves such a post untouched (state stays pending), so this is
   * the only place the wait can be told apart from a few seconds of upload.
   */
  youtubeQuotaFull?: boolean;
  /**
   * False when the account this post belongs to has no connection. A pending
   * leg on it cannot upload or post, whatever the platform could do ahead of
   * time, so the chip must not say "Uploading" or "Posts at slot". Absent means
   * the board does not know, and the platform's own wording stands.
   */
  connected?: boolean;
  /**
   * The runner has this leg claimed right now (a fresh `claimedAt`): it is being
   * sent, so a slot that has just passed is not "overdue" - it is in the middle
   * of going out.
   */
  inFlight?: boolean;
  /** Writes the slot for the hint ("Tue, Oct 14, 3:00 PM"); absent, the hint says "its slot". */
  formatSlot?: (publishAt: string) => string;
};

/**
 * How long after its slot a post may still be pending before the board calls it
 * overdue. The publisher runs every few minutes and an upload takes a while, so
 * a post a minute past its slot is on its way, not missed.
 */
export const OVERDUE_GRACE_MS = 10 * 60_000;

/** A pending post whose slot is gone and which the publisher has not delivered. */
export const OVERDUE_LABEL = "Overdue";
export const OVERDUE_HINT = "Its slot passed and the publisher hasn't sent it yet - check Automations";
export const OVERDUE_LINK_LABEL = "Check Automations";
export const OVERDUE_HREF = "/automations";

/** A scheduled YouTube/Facebook post whose slot has passed: the platform should have published it. */
export const SHOULD_BE_LIVE_LABEL = "Should be live";

/**
 * The line under the chip. The chip already says "Should be live" and the
 * button beside it says "Check <platform>", so the line adds the one thing
 * neither does: why the board thinks so.
 */
export function shouldBeLiveHint(platform: PlatformId): string {
  return `Its slot passed - ${PLATFORM_NAMES[platform]} should have published it by now.`;
}

/** Whether a slot is far enough behind for a post that never went out to be called overdue. */
export function slotOverdue(publishAt: string, now: Date): boolean {
  const slotMs = new Date(publishAt).getTime();
  return Number.isFinite(slotMs) && now.getTime() - slotMs > OVERDUE_GRACE_MS;
}

/** True when the runner claimed this leg recently enough that it is still being worked on. */
export function legInFlight(leg: Pick<PlatformState, "claimedAt"> | undefined, now: Date): boolean {
  if (!leg?.claimedAt) return false;
  const claimedMs = new Date(leg.claimedAt).getTime();
  return Number.isFinite(claimedMs) && now.getTime() - claimedMs <= OVERDUE_GRACE_MS;
}

export type PastSlotMarker =
  | { kind: "overdue"; label: string; hint: string; linkLabel: string; href: string }
  | { kind: "should-be-live"; label: string; hint: string; linkLabel: string; href: null };

/**
 * The marker for a leg whose slot has passed without the board's usual ending.
 *
 * Two different truths, said differently:
 *  - PENDING past its slot: nothing has been delivered. On every platform the
 *    app is the one that sends it (YouTube's upload and an Instagram/TikTok/
 *    Facebook post are all the runner's job), so the publisher has not run or
 *    is blocked - "Overdue", and Automations is where to look.
 *  - SCHEDULED past its slot on a platform that publishes by itself (YouTube,
 *    Facebook): the platform holds it and should have gone live; the runner
 *    flips it to published on its next pass. Not the app's fault and not an
 *    overdue post - "Should be live", check the platform. A long-form YouTube
 *    upload held private for review never goes live by itself, and a TikTok
 *    inbox draft is finished in the app, so neither is marked.
 *
 * Quiet while the leg is waiting on something that explains it better: no
 * connection, YouTube's quota, a claim in progress.
 */
export function pastSlotMarker(
  platform: PlatformId,
  leg: Pick<PlatformState, "status" | "postId" | "claimedAt">,
  item: Pick<QueueItem, "publishAt" | "format"> & { clipPath?: string },
  now: Date = new Date(),
  context: PendingContext = {}
): PastSlotMarker | null {
  if (!slotOverdue(item.publishAt, now)) return null;
  if (leg.status === "pending") {
    if (context.connected === false) return null;
    if (platform === "youtube" && context.youtubeQuotaFull) return null;
    if (context.inFlight || legInFlight(leg, now)) return null;
    return { kind: "overdue", label: OVERDUE_LABEL, hint: OVERDUE_HINT, linkLabel: OVERDUE_LINK_LABEL, href: OVERDUE_HREF };
  }
  if (leg.status === "scheduled" && PRE_SCHEDULES[platform] && leg.postId) {
    if (platform === "youtube" && youtubeHoldsForReview(item)) return null;
    return {
      kind: "should-be-live",
      label: SHOULD_BE_LIVE_LABEL,
      hint: shouldBeLiveHint(platform),
      linkLabel: `Check ${PLATFORM_NAMES[platform]}`,
      href: null
    };
  }
  return null;
}

function formatSlot(publishAt: string, context: PendingContext): string | undefined {
  return context.formatSlot?.(publishAt);
}

type PendingItem = Pick<QueueItem, "mediaKind" | "publishAt"> & Partial<Pick<QueueItem, "tiktok">>;

const QUOTA_WAIT_LABEL = "Waiting for quota";

/**
 * What "pending" means on the board. "Queued" reads as nothing has happened
 * yet, which is true for a platform this app has to post to itself and
 * misleading for one that is about to be handed the file.
 *
 * `now` is a parameter for the same reason it is one on `preSchedulesItem`:
 * with an item, the answer depends on how far off the slot is, and a function
 * whose answer changes with the clock but cannot be told what the clock says
 * can only be tested against the real one. It was, and the test aged into a
 * failure the day its fixture's slot went past.
 */
export function pendingLabel(
  platform?: PlatformId,
  item?: PendingItem,
  now: Date = new Date(),
  context: PendingContext = {}
): string {
  if (!platform) return "Queued";
  if (context.connected === false) return waitingForConnectionLabel(platform);
  if (platform === "youtube" && context.youtubeQuotaFull) return QUOTA_WAIT_LABEL;
  if (item && !context.inFlight && slotOverdue(item.publishAt, now)) return OVERDUE_LABEL;
  if (platform === "tiktok" && item && usesTiktokInbox(item)) return "To inbox at slot";
  if (item) return preSchedulesItem(platform, item, now) ? "Uploading" : "Posts at slot";
  return preSchedules(platform) ? "Uploading" : "Posts at slot";
}

const PLATFORM_NAMES: Record<PlatformId, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook"
};

/**
 * The chip for a leg whose account is not connected. ONE phrase for every way of
 * getting there - a pending leg and a manual reminder before its slot - so the
 * same situation never reads "Waiting for ..." on one card and "Manual" on the
 * next. The sentence under the chip says what to do about it.
 */
export function waitingForConnectionLabel(platform: PlatformId): string {
  return `Needs ${PLATFORM_NAMES[platform]} connection`;
}

/**
 * The line that explains it, and the way out. `when` is the slot as the screen
 * writes it ("Tue, Oct 14, 3:00 PM"); left out, the line says "its slot".
 */
export function waitingForConnectionHint(platform: PlatformId, when?: string): string {
  return `Waiting for ${PLATFORM_NAMES[platform]} - connect to post automatically, or post by hand at ${when ?? "its slot"}.`;
}

/** After the slot a leg that never went out is a miss, not a wait. */
export const POST_BY_HAND_LABEL = "Post by hand";

/**
 * What a "manual" leg - one set aside because nothing was connected when it was
 * booked - is called on a chip. Before its slot it is simply waiting for the
 * connection, exactly like a pending leg; after it the post has been missed and
 * the only thing left is to do it yourself. If an account has been connected
 * since, nothing is missing any more and Retry is the way back in.
 */
export function manualLabel(
  platform: PlatformId | undefined,
  publishAt: string | undefined,
  now: Date = new Date(),
  connected?: boolean
): string {
  const slotMs = publishAt ? new Date(publishAt).getTime() : Number.NaN;
  const upcoming = Number.isFinite(slotMs) && slotMs > now.getTime();
  if (connected === true) return "Retry to post";
  if (!upcoming && Number.isFinite(slotMs)) return POST_BY_HAND_LABEL;
  return platform ? waitingForConnectionLabel(platform) : "Needs connection";
}

/** The tooltip for a manual leg's chip, given the label `manualLabel` chose. */
export function manualHint(platform: PlatformId, label: string, when?: string): string {
  const name = PLATFORM_NAMES[platform];
  if (label === POST_BY_HAND_LABEL) return `${name} wasn't connected at this slot, so nothing was posted. Post it by hand, or connect ${name} and retry.`;
  if (label === "Retry to post") return `${name} is connected now. Retry puts this post back in the queue.`;
  return waitingForConnectionHint(platform, when);
}

/**
 * TikTok's inbox delivery ends with a draft only a tap in the TikTok app can
 * finish; the adapter records it as "scheduled" (adapters/tiktok.ts), which on
 * its own reads as done.
 */
export const TIKTOK_INBOX_CHIP = "In TikTok inbox";
/** The line shown beside the chip: a chip is one unbroken line and this is the part that needs room. */
export const TIKTOK_INBOX_ACTION = "Finish it in the TikTok app";
export const TIKTOK_INBOX_HINT =
  "TikTok has this as a draft in your inbox. Open the TikTok app and tap the notification to finish the post - it is not live until you do.";

/** True when this TikTok leg is a draft waiting in the creator's inbox. */
export function isTiktokInboxDraft(
  platform: PlatformId | undefined,
  status: string,
  item?: Partial<Pick<QueueItem, "tiktok">>
): boolean {
  return platform === "tiktok" && status === "scheduled" && Boolean(item) && usesTiktokInbox(item!);
}

export function pendingHint(
  platform?: PlatformId,
  item?: PendingItem,
  now: Date = new Date(),
  context: PendingContext = {}
): string {
  if (!platform) return "Waiting for the publish runner.";
  const name = PLATFORM_NAMES[platform];
  if (context.connected === false) return waitingForConnectionHint(platform, item ? formatSlot(item.publishAt, context) : undefined);
  if (platform === "youtube" && context.youtubeQuotaFull) {
    return "YouTube's upload limit for today is used up, so this waits and goes up after the quota resets (midnight Pacific). Nothing is lost.";
  }
  if (item && !context.inFlight && slotOverdue(item.publishAt, now)) return OVERDUE_HINT;
  // Only a slot BEYOND the window gets the "further out than Facebook will
  // hold it" wording. One that is inside a quarter of an hour, or already past,
  // is also not pre-scheduled - and telling someone their overdue post is too
  // far in the future is worse than saying nothing.
  if (item && platform === "facebook" && facebookLead(item.publishAt, now) === "too-far") {
    return "This slot is further out than Facebook will hold a post (29 days), so it goes up as soon as it is inside that window.";
  }
  if (platform === "tiktok" && item && usesTiktokInbox(item)) {
    return "TikTok has no scheduling API, so CoLateral Marketing sends this to your TikTok inbox at this slot. You then finish the post in the TikTok app.";
  }
  return (item ? preSchedulesItem(platform, item, now) : preSchedules(platform))
    ? `${name} takes the upload ahead of time — it goes up now and ${name} publishes it at this slot.`
    : `${name} has no scheduling API, so CoLateral Marketing posts this itself at this slot. Nothing else is needed.`;
}
