import type { FailureAdvice } from "@/lib/publisher/failure";
import { youtubeHoldsForReview } from "@/lib/publisher/reviewHold";
import { isSameDayOrEarlier } from "@/lib/publisher/schedule";
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

/** The queue's default claim lease (config `claimTimeoutMinutes`); the board has no config. */
export const DEFAULT_CLAIM_TIMEOUT_MINUTES = 15;

/** What Remove says while a runner holds a fresh claim on one of the post's legs. */
export const UPLOADING_NOW_MESSAGE = "This post is uploading right now - try again in a minute.";

/**
 * What Remove says when a YouTube upload was started but no video id came back.
 * The upload session is recorded before any bytes move, so the video may exist
 * on the channel without the queue knowing; Remove cannot hold it private.
 */
export const YOUTUBE_MAY_EXIST_MESSAGE =
  "A video may already exist on YouTube for this post (an upload was started but never confirmed). Removing it here cannot keep that video private. Check YouTube Studio first.";

export type RemovalImpact = {
  /** Every platform on the item, in the order it will be listed. */
  platforms: PlatformId[];
  /** A runner holds a fresh claim on a leg: the upload is in flight right now. */
  uploading: boolean;
  /** A YouTube upload session exists but no video id was recorded. */
  youtubeMayExist: boolean;
  /** The YouTube video that would still go live at its slot, if there is one. */
  youtube: PlatformHold | null;
  /** The Facebook post that stays scheduled on the Page, if there is one. */
  facebook: PlatformHold | null;
  /**
   * Platforms where this post is already live. Removing never takes those down;
   * the confirmation says so instead of "nothing has gone up yet".
   */
  published: PlatformId[];
  /** Every leg is live, so Remove would only erase the schedule's record of it. */
  fullyPublished: boolean;
};

const ORDER: PlatformId[] = ["youtube", "instagram", "tiktok", "facebook", "linkedin"];

/** A leg whose post exists on the platform and has not gone out yet. */
function holdsPost(state: PlatformState | undefined): state is PlatformState & { postId: string } {
  if (!state?.postId) return false;
  return state.status === "uploaded" || state.status === "scheduled" || state.status === "pending" || state.status === "failed";
}

/** True when any leg was claimed within the claim timeout, i.e. a runner is working on it. */
export function hasFreshClaim(
  item: Pick<QueueItem, "platforms">,
  now: Date = new Date(),
  claimTimeoutMinutes: number = DEFAULT_CLAIM_TIMEOUT_MINUTES
): boolean {
  return Object.values(item.platforms).some((state) => {
    if (!state?.claimedAt) return false;
    const age = now.getTime() - new Date(state.claimedAt).getTime();
    return Number.isFinite(age) && age < claimTimeoutMinutes * 60_000;
  });
}

export function removalImpact(
  item: Pick<QueueItem, "platforms">,
  options: { now?: Date; claimTimeoutMinutes?: number } = {}
): RemovalImpact {
  const present = ORDER.filter((platform) => item.platforms[platform]);
  const youtube = item.platforms.youtube;
  const facebook = item.platforms.facebook;
  const published = present.filter((platform) => item.platforms[platform]?.status === "published");
  return {
    platforms: present,
    published,
    fullyPublished: present.length > 0 && published.length === present.length,
    uploading: hasFreshClaim(item, options.now, options.claimTimeoutMinutes),
    youtubeMayExist: Boolean(youtube?.containerId && !youtube.postId && youtube.status !== "published"),
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

/**
 * The request that puts a removed post back, or null when it cannot be put back
 * faithfully. Remove deletes the queue item; "Undo" books the same file again
 * through POST /api/publish, which is `enqueue()` - so every rule that applies
 * to a new booking applies to the restore, and this only offers it where the
 * result is the post that was removed:
 *
 *  - Nothing may have reached a platform. A leg with a video id, a container, a
 *    claim or an attempt has state a fresh booking cannot recreate, and a YouTube
 *    video Remove had to hold private would be uploaded a second time.
 *  - Not a picture post (booked through another route), not a pipeline run's
 *    output (`runId` is not part of the request), not a leg the runner mirrored
 *    onto the post (booking again would not copy it back).
 *  - The slot must still be bookable: `enqueue()` refuses today, so offering
 *    Undo for a slot that is today's (or past) would only fail.
 *
 * Pure, so the rule is tested without a browser.
 */
export function removalUndoRequest(
  item: QueueItem,
  options: { now?: Date; timeZone: string }
): Record<string, unknown> | null {
  const { now = new Date(), timeZone } = options;
  if (item.mediaKind === "image" || item.runId || item.buffer) return null;
  const platforms = ORDER.filter((platform) => item.platforms[platform]);
  if (platforms.length === 0) return null;
  for (const platform of platforms) {
    const leg = item.platforms[platform] as PlatformState;
    if (leg.status !== "pending" && leg.status !== "manual") return null;
    if (leg.postId || leg.containerId || leg.claimedAt || leg.mirroredFrom || leg.attempts > 0) return null;
  }
  if (isSameDayOrEarlier(item.publishAt, now, timeZone)) return null;
  return {
    // The master when the post carries a vertical re-render of it: booking the
    // master re-renders (and records the source) exactly as the first booking did.
    clipPath: item.sourceClipPath ?? item.clipPath,
    publishAt: item.publishAt,
    title: item.title,
    caption: item.caption ?? "",
    hashtags: item.hashtags ?? [],
    platforms,
    visibility: item.visibility,
    ...(item.jobId ? { jobId: item.jobId } : {}),
    ...(item.accountId ? { accountId: item.accountId } : {}),
    ...(item.format ? { format: item.format } : {}),
    ...(item.tiktok && platforms.includes("tiktok") ? { tiktok: item.tiktok } : {})
  };
}

/** What Remove says about the posts that are already live: it clears the schedule, not the platform. */
export function publishedRemovalNote(published: PlatformId[], names: Record<PlatformId, string>): string {
  const labels = published.map((platform) => names[platform]);
  const list = labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `Already live on ${list}. Removing only clears it from this schedule; the posts stay up.`;
}

/** Meta Business Suite's calendar - where a Page's scheduled posts can be cancelled. */
export const FACEBOOK_SCHEDULED_POSTS_URL = "https://business.facebook.com/latest/content_calendar";

/**
 * The platforms a forced Publish now acts on - the same rule as the forced
 * branch of `runDue`: anything not finished, plus a post YouTube or Facebook is
 * holding for its slot (which is released early). Failed and manual legs are
 * Retry's, and a TikTok draft already in the inbox has nothing left to send.
 */
export function publishNowTargets(
  item: Pick<QueueItem, "platforms"> & Partial<Pick<QueueItem, "format" | "clipPath">>,
  isConnected?: PlatformConnected
): PlatformId[] {
  return ORDER.filter((platform) => {
    const state = item.platforms[platform];
    if (!state) return false;
    // A leg whose account has no connection cannot be sent, so Publish now
    // does not claim it (it stays waiting for the connection).
    if (isConnected && !isConnected(platform)) return false;
    // A long-form video is held private for review by design, so Publish now
    // would not publish it, whatever state its leg is in; do not offer what it
    // will not do.
    if (platform === "youtube" && youtubeHoldsForReview(item)) return false;
    if (state.status === "pending" || state.status === "uploaded") return true;
    if (state.status !== "scheduled") return false;
    return platform === "youtube" || platform === "facebook";
  });
}

/**
 * True only once the account list has loaded and not one account is connected.
 * Publish now is drawn per post and needs a connected account, so the board's
 * standing hint about it must not point at a button that cannot appear. Until
 * the list loads nothing is known, and nothing is claimed.
 */
export function noAccountConnected(accounts: ReadonlyArray<{ connected: boolean }>): boolean {
  return accounts.length > 0 && accounts.every((account) => !account.connected);
}

/** Whether the account a post uses on one platform has a connection. */
export type PlatformConnected = (platform: PlatformId) => boolean;

/**
 * The legs Publish now would have sent but cannot, because their account is not
 * connected. The confirmation names them: they stay waiting, they do not fail.
 */
export function publishNowSkipped(
  item: Pick<QueueItem, "platforms"> & Partial<Pick<QueueItem, "format" | "clipPath">>,
  isConnected: PlatformConnected
): PlatformId[] {
  const connected = new Set(publishNowTargets(item, isConnected));
  return publishNowTargets(item).filter((platform) => !connected.has(platform));
}

/** The account id a post uses on a platform (legacy posts belong to the primary). */
export function legAccountId(item: Pick<QueueItem, "accountId">, platform: PlatformId): string {
  return item.accountId ?? `${platform}-primary`;
}

export type BlockedLegControls = {
  /** Retry (now / at slot) can work, so it is offered. */
  retry: boolean;
  /** The Connect / Reconnect link, or null when a connection is not what is missing. */
  connect: "Connect" | "Reconnect" | null;
  /** Rename and retry: the title is what the channel refused. */
  rename: boolean;
  /** The fix needs a connection first, so any Retry waits for it. */
  needsConnection: boolean;
};

/**
 * Which controls a failed or manual leg's card offers. CONNECTION STATE WINS:
 * a leg whose account is not connected cannot be retried whatever the error
 * said - a TikTok "rejected this upload" retried without a login only fails
 * again - so Retry is hidden and Connect/Reconnect is shown. A fix that does not
 * need a connection (a duplicate title is changed on the card; a missing file is
 * beyond any control) is still offered or withheld on its own terms.
 */
export function blockedLegControls(
  advice: Pick<FailureAdvice, "action" | "kind">,
  options: { connected: boolean; retitled: boolean }
): BlockedLegControls {
  const { connected, retitled } = options;
  const rename = advice.kind === "duplicate-title" && !retitled;
  // Nothing a connection could change.
  if (advice.kind === "missing-media") return { retry: false, connect: null, rename: false, needsConnection: false };
  if (!connected) {
    return {
      retry: false,
      connect: advice.kind === "connection-lapsed" ? "Reconnect" : "Connect",
      rename,
      needsConnection: true
    };
  }
  return {
    retry: advice.action !== "none" || retitled,
    // Connected, but the credentials on record lapsed: reconnecting refreshes them.
    connect: advice.kind === "connection-lapsed" ? "Reconnect" : null,
    rename,
    needsConnection: false
  };
}

/**
 * Which inline action on a failed card is the FILLED one: the control that fixes
 * THIS failure. A refused title is fixed by renaming - Connect is only there so
 * the retry afterwards can work - so Rename leads whenever it is offered. Connect
 * leads when the connection is what is missing (including a title already
 * renamed, which leaves only the connection). Null when neither is offered.
 */
export function primaryInlineAction(
  controls: Pick<BlockedLegControls, "connect" | "rename">
): "rename" | "connect" | null {
  if (controls.rename) return "rename";
  if (controls.connect) return "connect";
  return null;
}

/**
 * The words on the Connect / Reconnect link. A title the channel refused is
 * fixed by renaming, and Retry is only waiting on the connection - so beside
 * Rename the link says what it is FOR ("Connect YouTube to retry"), or a card
 * that offers both reads as two unrelated chores.
 */
export function connectLinkLabel(
  controls: Pick<BlockedLegControls, "connect" | "needsConnection">,
  advice: Pick<FailureAdvice, "kind"> | null,
  platformLabel: string
): string | null {
  if (!controls.connect) return null;
  const base = `${controls.connect} ${platformLabel}`;
  return advice?.kind === "duplicate-title" && controls.needsConnection ? `${base} to retry` : base;
}
