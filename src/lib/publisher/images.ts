import type { PlatformId, QueueItem } from "@/lib/publisher/types";

/**
 * Image posts in the publish queue — one picture, or an ordered deck of them
 * (a carousel). Everything the queue stored before this existed is a video
 * post, so an item is an image post only when it says so: `mediaKind` absent
 * means video, exactly as before.
 *
 * An image item still fills `clipPath` with its FIRST image. Every path-based
 * lookup in the app (the pipeline's "already scheduled" check, the Uploading
 * Center's card matching, the calendar) reads that field, and a post they
 * cannot see is a post that gets booked twice.
 */

/** Networks that can take a picture post through the app's own integrations. */
export const IMAGE_CAPABLE_PLATFORMS: PlatformId[] = ["instagram", "facebook"];

/**
 * Why the other two are refused rather than queued. YouTube's Data API has no
 * image endpoint at all (community posts are not in any public API), and
 * TikTok's photo mode needs its own audited Content Posting scope, which this
 * app has not been granted.
 */
export const IMAGE_REFUSALS: Partial<Record<PlatformId, string>> = {
  youtube: "YouTube has no API for picture posts — only video uploads. Post this one by hand if it needs to be on YouTube.",
  tiktok:
    "TikTok photo posts need the audited photo scope of the Content Posting API, which this app is not approved for. Post this one by hand."
};

/**
 * Instagram publishes at most 10 items in one carousel, and a Facebook feed
 * post with more attached photos than that starts collapsing them. One ceiling
 * for both keeps a deck that books for Instagram bookable for Facebook too.
 */
export const MAX_IMAGES_PER_POST = 10;

/**
 * Instagram's Content Publishing API scales a picture into this band and
 * refuses one outside it. The numbers live here rather than in the adapter
 * because whatever RENDERS a deck has to obey them — a 1920px-wide landscape
 * deck booked at a slot is a post that can only fail, hours after anyone could
 * do anything about it.
 */
export const IMAGE_POST_MIN_WIDTH = 320;
export const IMAGE_POST_MAX_WIDTH = 1440;

/**
 * And the shapes it accepts: 4:5 (0.8) to 1.91:1. A story-shaped deck is 0.5625
 * — well outside — so a 9:16 deck booked at a slot is another post that can only
 * fail hours later. Same reason the widths live here: whatever renders a deck
 * has to know before anything is booked.
 */
export const IMAGE_POST_MIN_ASPECT = 0.8;
export const IMAGE_POST_MAX_ASPECT = 1.91;

export function imagePostAspectAllowed(width: number, height: number): boolean {
  if (!(width > 0) || !(height > 0)) return false;
  const ratio = width / height;
  // A hair of tolerance: 1080x1350 is 0.8 exactly in decimal but not in floats.
  return ratio >= IMAGE_POST_MIN_ASPECT - 0.001 && ratio <= IMAGE_POST_MAX_ASPECT + 0.001;
}

/** The nearest width to `natural` that a picture post is allowed to be. */
export function imagePostWidth(natural: number): number {
  return Math.min(IMAGE_POST_MAX_WIDTH, Math.max(IMAGE_POST_MIN_WIDTH, Math.round(natural)));
}

export const SUPPORTED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

export const IMAGE_CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};

// No node:path here — the schedule board imports this module into the browser
// bundle to tell a picture post from a video one.
export function isSupportedImagePath(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  return dot > 0 && SUPPORTED_IMAGE_EXTENSIONS.includes(filePath.slice(dot).toLowerCase());
}

/** True when this queue item posts pictures rather than a video. */
export function isImagePost(item: Pick<QueueItem, "mediaKind">): boolean {
  return item.mediaKind === "image";
}

/** True when the item is a multi-image deck rather than a single picture. */
export function isCarouselPost(item: Pick<QueueItem, "mediaKind" | "imagePaths">): boolean {
  return isImagePost(item) && (item.imagePaths?.length ?? 0) > 1;
}

/** The item's images in posting order, or an empty list for a video post. */
export function imagePathsOf(item: Pick<QueueItem, "mediaKind" | "imagePaths" | "clipPath">): string[] {
  if (!isImagePost(item)) return [];
  return item.imagePaths?.length ? item.imagePaths : [item.clipPath];
}

/**
 * Where the browser reads one picture of a queued image post. By position, not
 * by path — the files live under `data/`, which is not served, and the queue is
 * the only thing that gets to say which file a position means.
 */
export function imagePostUrl(itemId: string, index: number, options: { download?: boolean } = {}): string {
  return `/api/publish/${encodeURIComponent(itemId)}/images/${index}${options.download ? "?download=1" : ""}`;
}

/**
 * Splits requested platforms into the ones that can carry a picture post and
 * the ones that must be refused, with the reason. Nothing that cannot post is
 * ever queued — a picture booked to YouTube would sit in the queue until its
 * slot and then fail, which is the worst possible moment to find out.
 */
export function splitImagePlatforms(platforms: PlatformId[]): {
  supported: PlatformId[];
  refused: { platform: PlatformId; reason: string }[];
} {
  const supported: PlatformId[] = [];
  const refused: { platform: PlatformId; reason: string }[] = [];
  for (const platform of platforms) {
    if (IMAGE_CAPABLE_PLATFORMS.includes(platform)) supported.push(platform);
    else refused.push({ platform, reason: IMAGE_REFUSALS[platform] ?? `${platform} cannot take picture posts.` });
  }
  return { supported, refused };
}
