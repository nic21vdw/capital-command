import { ALL_PLATFORMS, type PlatformId, type QueueItem } from "@/lib/publisher/types";

/**
 * The ONE definition of "a post that failed and still needs a hand".
 *
 * A failed leg is a platform whose state is `failed`: it stays failed until the
 * post is retried, removed or swept by retention, so "unresolved" is simply
 * "failed right now". The Uploading Center's "Failed (N)" strip and the nav
 * badge / window title both read this, and they used to disagree - the badge
 * counted posts, looked back a week only, and dropped a failure the moment the
 * board had been opened, so it read 0 while the strip said 14.
 *
 * Whether a failure has been SEEN decides only whether to notify about it
 * again (see attention/failures.ts), never whether it counts.
 *
 * Pure and client-safe.
 */
export function failedLegPlatforms(item: Pick<QueueItem, "platforms">): PlatformId[] {
  return ALL_PLATFORMS.filter((platform) => item.platforms[platform]?.status === "failed");
}

/** Failed legs across a queue: the number on the strip and on the badge. */
export function countFailedLegs(items: Pick<QueueItem, "platforms">[]): number {
  return items.reduce((total, item) => total + failedLegPlatforms(item).length, 0);
}
