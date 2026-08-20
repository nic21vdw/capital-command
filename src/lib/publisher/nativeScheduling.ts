import type { PlatformId, QueueItem } from "@/lib/publisher/types";

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

/**
 * What "pending" means on the board. "Queued" reads as nothing has happened
 * yet, which is true for a platform this app has to post to itself and
 * misleading for one that is about to be handed the file.
 */
export function pendingLabel(platform?: PlatformId, item?: Pick<QueueItem, "mediaKind" | "publishAt">): string {
  if (!platform) return "Queued";
  if (item) return preSchedulesItem(platform, item) ? "Uploading" : "Posts at slot";
  return preSchedules(platform) ? "Uploading" : "Posts at slot";
}

const PLATFORM_NAMES: Record<PlatformId, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook"
};

export function pendingHint(platform?: PlatformId, item?: Pick<QueueItem, "mediaKind" | "publishAt">): string {
  if (!platform) return "Waiting for the publish runner.";
  const name = PLATFORM_NAMES[platform];
  if (item && platform === "facebook" && !preSchedulesItem(platform, item)) {
    return "This slot is further out than Facebook will hold a post (29 days), so it goes up as soon as it is inside that window.";
  }
  return (item ? preSchedulesItem(platform, item) : preSchedules(platform))
    ? `${name} takes the upload ahead of time — it goes up now and ${name} publishes it at this slot.`
    : `${name} has no scheduling API, so Capital Command posts this itself at this slot. Nothing else is needed.`;
}
