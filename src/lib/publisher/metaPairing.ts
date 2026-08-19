import { isPrimaryAccountId } from "@/lib/publisher/accounts";
import type { PlatformId } from "@/lib/publisher/types";

/**
 * Instagram and the Facebook Page are one Meta presence, so a clip scheduled
 * to Instagram is scheduled to Facebook as well — the same file, the same
 * caption, the same instant, on the one queue item. Nothing has to remember to
 * tick Facebook, and no second item is created, so the duplicate guard and the
 * calendar keep seeing one post.
 *
 * The one case that stays Instagram-only is a non-primary Instagram account:
 * an extra account can only take its own platform's posts (`accounts.ts`), and
 * there is no Facebook Page paired with it to post to.
 */
export function facebookRidesAlong(accountId?: string): boolean {
  return !accountId || isPrimaryAccountId(accountId);
}

export function withFacebookAlongsideInstagram(platforms: PlatformId[], accountId?: string): PlatformId[] {
  if (!platforms.includes("instagram") || platforms.includes("facebook")) return platforms;
  if (!facebookRidesAlong(accountId)) return platforms;
  return [...platforms, "facebook"];
}
