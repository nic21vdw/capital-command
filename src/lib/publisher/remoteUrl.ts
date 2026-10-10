import type { PlatformId, PlatformStatus } from "@/lib/publisher/types";

/**
 * A link to a post on its own platform, built from the id the publisher stored.
 * Only the shapes that are known to work are built; anything else answers null
 * rather than a guess that lands on a "this page isn't available" screen.
 *
 *   YouTube   watch?v=<video id>. Works for a private or scheduled upload too,
 *             because the owner can open it.
 *   Facebook  facebook.com/<id>, but only once the post is published: a
 *             scheduled one has an id and no public page yet, so `status` has
 *             to say "published".
 *   Instagram / TikTok  the stored id is a media or publish id, not something a
 *             URL can be made from. A full URL is used if one was ever stored.
 *
 * Pure and client-safe: the schedule board, the calendars and the Day Summary
 * all link through it.
 */
export function remoteUrlFor(
  platform: PlatformId,
  postId: string | undefined,
  status?: PlatformStatus
): string | null {
  const id = postId?.trim();
  if (!id) return null;
  if (/^https:\/\//i.test(id)) return id;
  if (platform === "youtube") return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  if (platform === "facebook" && status === "published" && /^[\w.-]+$/.test(id)) {
    return `https://www.facebook.com/${id}`;
  }
  return null;
}
