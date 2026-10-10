import { youtubeHoldsForReview } from "@/lib/publisher/reviewHold";
import type { PlatformId, PlatformState, QueueItem } from "@/lib/publisher/types";

/**
 * What the board's Publish now and Remove really do, platform by platform, so
 * the confirmation each one asks for says the truth.
 *
 * REMOVE
 *
 * Remove deletes the whole queue item - every platform on it, whichever tab it
 * was pressed on - and the queue forgetting a post does not make a platform
 * forget it. YouTube already holds an uploaded video with its go-live time, and
 * Facebook holds a Reel or picture post it was handed ahead of the slot. This
 * is the one place that says which legs those are, so the confirmation the
 * board shows and the DELETE route that acts on it cannot disagree.
 *
 * PUBLISH NOW is a forced run of the whole post (runner.ts, `force`), not of
 * the tab it was pressed on, so the confirmation lists every platform it will
 * touch (`publishNowTargets`).
 *
 * Pure and free of server imports: the schedule board is a client component.
 */

export type PlatformHold = { platform: PlatformId; postId: string };

export type RemovalImpact = {
  /** Every platform on the item, in the order it will be listed. */
  platforms: PlatformId[];
  /** The YouTube video that would still go live at its slot, if there is one. */
  youtube: PlatformHold | null;
  /** The Facebook post that stays scheduled on the Page, if there is one. */
  facebook: PlatformHold | null;
};

const ORDER: PlatformId[] = ["youtube", "instagram", "tiktok", "facebook"];

/** A leg whose post exists on the platform and has not gone out yet. */
function holdsPost(state: PlatformState | undefined): state is PlatformState & { postId: string } {
  if (!state?.postId) return false;
  return state.status === "uploaded" || state.status === "scheduled" || state.status === "pending" || state.status === "failed";
}

export function removalImpact(item: Pick<QueueItem, "platforms">): RemovalImpact {
  const present = ORDER.filter((platform) => item.platforms[platform]);
  const youtube = item.platforms.youtube;
  const facebook = item.platforms.facebook;
  return {
    platforms: present,
    youtube: holdsPost(youtube) ? { platform: "youtube", postId: youtube.postId } : null,
    // Facebook's handle is the post id (a Reel's video id, a photo post's id).
    // Only a post it actually holds counts; a leg that never got that far has
    // nothing on the Page to warn about.
    facebook:
      facebook?.postId && (facebook.status === "scheduled" || facebook.status === "uploaded")
        ? { platform: "facebook", postId: facebook.postId }
        : null
  };
}

/** Meta Business Suite's calendar - where a Page's scheduled posts can be cancelled. */
export const FACEBOOK_SCHEDULED_POSTS_URL = "https://business.facebook.com/latest/content_calendar";

/**
 * The platforms a forced Publish now acts on - the same rule as the forced
 * branch of `runDue`: anything not finished, plus a post YouTube or Facebook is
 * holding for its slot (which is released early). Failed and manual legs are
 * Retry's, and a TikTok draft already in the inbox has nothing left to send.
 */
export function publishNowTargets(item: Pick<QueueItem, "platforms"> & Partial<Pick<QueueItem, "format" | "clipPath">>): PlatformId[] {
  return ORDER.filter((platform) => {
    const state = item.platforms[platform];
    if (!state) return false;
    if (state.status === "pending" || state.status === "uploaded") return true;
    if (state.status !== "scheduled") return false;
    // A long-form video is held private for review by design, so Publish now
    // would not publish it; do not offer what it will not do.
    if (platform === "youtube") return !youtubeHoldsForReview(item);
    return platform === "facebook";
  });
}
