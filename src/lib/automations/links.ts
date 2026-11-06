import type { PlatformId, QueueItem } from "@/lib/publisher/types";

/**
 * The Uploading Center link for one queued post, so an Automations row opens
 * the post and not the board. The same shape the Master Calendar uses for its
 * events (`?item=` plus the first platform the post targets).
 */
export function uploadingCenterHref(item: Pick<QueueItem, "id" | "platforms">): string {
  const params = new URLSearchParams({ item: item.id });
  const platform = (["youtube", "instagram", "tiktok", "facebook", "linkedin"] as PlatformId[]).find((id) => item.platforms[id]);
  if (platform) params.set("platform", platform);
  return `/uploading-center?${params.toString()}`;
}

/** Where a history row's `itemId` leads, per automation. Null when no deeper page exists. */
export function historyItemHref(automationId: string, itemId: string | undefined): string | null {
  if (!itemId) return null;
  if (automationId === "publisher") return `/uploading-center?${new URLSearchParams({ item: itemId })}`;
  // Threads and podcast items have no per-item page; their screen is where the item lives.
  if (automationId === "threads") return "/x-posts";
  if (automationId === "podcast") return "/podcast";
  return null;
}

const FACEBOOK_SCHEDULED = "https://business.facebook.com/latest/posts/scheduled_posts";

/** Where to look at a post a platform holds (and cancel it): the platform's own scheduled-posts page. */
export function platformCheckUrl(platform: string, postId?: string): string | null {
  if (platform === "YouTube") return postId ? `https://studio.youtube.com/video/${encodeURIComponent(postId)}/edit` : "https://studio.youtube.com";
  if (platform === "Facebook") return FACEBOOK_SCHEDULED;
  return null;
}
