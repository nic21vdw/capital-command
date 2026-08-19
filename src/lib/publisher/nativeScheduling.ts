import type { PlatformId } from "@/lib/publisher/types";

/**
 * Which platforms take a post BEFORE its time and publish it themselves.
 *
 * This is the difference between a post that is really booked and one that is
 * only written down here. YouTube accepts the upload the moment it is queued
 * with status.publishAt set, so the video sits in YouTube Studio as Scheduled
 * and goes live without this app being awake. Instagram and TikTok have no
 * scheduling in their publishing APIs at all, and the Facebook Reels finish
 * call can schedule but this app does not use that yet — for those three the
 * runner IS the scheduler, and it posts at the slot.
 *
 * The queue's due rule and the board's wording both read this, so a platform
 * that gains native scheduling changes behaviour and copy from one line.
 */
export const PRE_SCHEDULES: Record<PlatformId, boolean> = {
  youtube: true,
  instagram: false,
  tiktok: false,
  facebook: false
};

export function preSchedules(platform: PlatformId): boolean {
  return PRE_SCHEDULES[platform];
}

/**
 * What "pending" means on the board, per platform. "Queued" reads as nothing
 * has happened yet, which is true for a platform this app has to post to
 * itself and misleading for one that is about to be handed the file.
 */
export function pendingLabel(platform?: PlatformId): string {
  if (!platform) return "Queued";
  return preSchedules(platform) ? "Uploading" : "Posts at slot";
}

const PLATFORM_NAMES: Record<PlatformId, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook"
};

export function pendingHint(platform?: PlatformId): string {
  if (!platform) return "Waiting for the publish runner.";
  return preSchedules(platform)
    ? `${PLATFORM_NAMES[platform]} takes the upload ahead of time — it goes up now and ${PLATFORM_NAMES[platform]} publishes it at this slot.`
    : `${PLATFORM_NAMES[platform]} has no scheduling API, so Capital Command posts this itself at this slot. Nothing else is needed.`;
}
