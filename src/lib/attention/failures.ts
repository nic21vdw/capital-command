import { describeFailure } from "@/lib/publisher/failure";
import { countFailedLegs, failedLegPlatforms } from "@/lib/publisher/failedLegs";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";
import type { ThreadsQueueItem } from "@/lib/threads/types";
import type { AppNotification } from "@/lib/colateral/protocol";

/**
 * What the sidebar badge and the "(N)" window title count besides stream runs:
 * posts that failed. Until now a post that failed when it was due to publish,
 * or a Threads post the API rejected, raised nothing anywhere; it was found
 * hours later by opening the right page.
 *
 * Pure, so the rules are tested here rather than eyeballed. Read by
 * GET /api/pipeline?summary=1, which is the one request the shell already makes
 * every minute.
 *
 * THE COUNT IS UNRESOLVED FAILURES, and nothing else. It is the number on the
 * Uploading Center's "Failed (N)" strip - both read `failedLegPlatforms` - plus
 * the Threads posts that are failed. A failure stops counting only when it is
 * fixed: retried, removed, or swept by retention. Opening the page does not
 * clear it, and neither does age; a badge that reads 0 over a strip that says
 * 14 is a badge nobody trusts.
 *
 *  - One per failed platform leg (YouTube, Instagram, TikTok, Facebook), so a
 *    post that lost two networks is two things to fix.
 *  - A Threads post whose status is `failed`.
 *  - "manual" legs do not count. They are reminders, not failures, and they are
 *    listed as to-dos on Day Summary instead.
 *
 * What "seen" still does: `failedSeenAt` (stamped when the Uploading Center
 * loads) stops a fully failed post being sent to the host AGAIN as a
 * notification. It never lowers the count.
 */

/** At most this many individual failures are sent to the host per poll. */
export const MAX_FAILURES_LISTED = 10;

export type AttentionBreakdown = {
  /** Stream runs asking for something, plus a failed channel scan. */
  pipeline: number;
  /** Publish-queue posts with a failed leg. */
  publish: number;
  /** Failed Threads posts. */
  threads: number;
};

export type AttentionFailure = AppNotification & {
  kind: "publish" | "threads";
  /** The slot, so the list can be ordered newest first. */
  at: string;
};

const PLATFORM_LABELS: Record<PlatformId, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook"
};

function isFullyFailed(item: QueueItem): boolean {
  const states = Object.values(item.platforms);
  return states.length > 0 && states.every((state) => state?.status === "failed") && (!item.buffer || item.buffer.status === "failed");
}

/** True when this queue post has a failure nobody has fixed yet. */
export function publishNeedsAttention(item: QueueItem): boolean {
  return failedLegPlatforms(item).length > 0 || item.buffer?.status === "failed";
}

/**
 * True when the host should be TOLD about this post's failure: it has one, and
 * it is not a fully failed post the board has already shown. This is about not
 * repeating a notification; the count ignores it.
 */
function worthNotifying(item: QueueItem): boolean {
  return publishNeedsAttention(item) && !(isFullyFailed(item) && item.failedSeenAt);
}

function shortTitle(text: string, max = 80): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** The failing posts, one entry per failed leg, newest slot first. */
export function publishFailures(queue: QueueItem[]): AttentionFailure[] {
  const failures: AttentionFailure[] = [];
  for (const item of queue) {
    if (!worthNotifying(item)) continue;
    for (const platform of failedLegPlatforms(item)) {
      const state = item.platforms[platform];
      if (!state) continue;
      const advice = describeFailure(state, platform);
      const label = PLATFORM_LABELS[platform];
      // A reconnect headline already says what to do; the others need pointing
      // at the card where Retry is.
      const next =
        advice.action === "reconnect"
          ? ""
          : advice.action === "retry"
            ? " Open the post in the Uploading Center and retry it."
            : " Open the post in the Uploading Center to see what to do.";
      failures.push({
        kind: "publish",
        // A post that is retried and fails again is a new event, while an
        // unchanged failure keeps its id so the host can dedupe it. `attempts`
        // alone cannot tell: a re-arm resets it to 0, so the same count comes
        // round again. The failure time moves on every failed try; legs from
        // before it was recorded fall back to the count.
        id: `publish-failed:${item.id}:${platform}:${state.lastFailedAt ?? state.attempts ?? 0}`,
        level: "error",
        title: `A ${label} post failed`,
        body: `"${shortTitle(item.title || item.caption || "Untitled post")}": ${advice.headline}${next}`,
        route: `/uploading-center?item=${encodeURIComponent(item.id)}&platform=${platform}`,
        at: item.publishAt
      });
    }
    if (item.buffer?.status === "failed") {
      failures.push({
        kind: "publish",
        id: `publish-failed:${item.id}:buffer:${item.buffer.attempts ?? 0}`,
        level: "error",
        title: "A Buffer post failed",
        body: `"${shortTitle(item.title || item.caption || "Untitled post")}": Buffer did not take this post. Open the post in the Uploading Center to see what to do.`,
        route: `/uploading-center?item=${encodeURIComponent(item.id)}`,
        at: item.publishAt
      });
    }
  }
  return failures.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Failed legs in the publish queue: exactly the number on the Uploading
 * Center's "Failed (N)" strip. (A Buffer hand-off that failed still raises a
 * notification, but it has no leg on the strip, so it is not added here.)
 */
export function countPublishAttention(queue: QueueItem[]): number {
  return countFailedLegs(queue);
}

const THREADS_CONNECTION = /reconnect|expired|revoked|unauthoriz|unauthentic|invalid.*token|\b401\b|\b190\b/i;

/** Failed Threads posts: the queue's own retention decides how long they stay. */
export function threadsFailedItems(items: ThreadsQueueItem[]): ThreadsQueueItem[] {
  return items.filter((item) => item.status === "failed");
}

export function threadsFailures(items: ThreadsQueueItem[]): AttentionFailure[] {
  return threadsFailedItems(items)
    .map((item): AttentionFailure => {
      const reconnect = Boolean(item.error && THREADS_CONNECTION.test(item.error));
      return {
        kind: "threads",
        // Same as the publish ids: a retry resets `attempts`, the failure time
        // does not repeat.
        id: `threads-failed:${item.id}:${item.lastFailedAt ?? item.attempts ?? 0}`,
        level: "error",
        title: "A Threads post failed",
        body: `"${shortTitle(item.topic || item.text || "Untitled post")}": ${
          reconnect
            ? "The Threads connection expired or was revoked. Reconnect it in Settings, then retry the post."
            : "Threads would not take this post. Open Threads Autopilot and retry it."
        }`,
        route: "/x-posts",
        at: item.publishAt
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * The summary's attention fields. `pipeline` is the count the badge already had;
 * the total is what the sidebar badge and the window title show, and the
 * breakdown is how the UI explains it.
 */
export function attentionSummary(input: {
  pipeline: number;
  queue: QueueItem[];
  threadsItems: ThreadsQueueItem[];
}): { needsAttention: number; breakdown: AttentionBreakdown; failures: AttentionFailure[] } {
  const publish = countPublishAttention(input.queue);
  const threads = threadsFailedItems(input.threadsItems).length;
  const failures = [...publishFailures(input.queue), ...threadsFailures(input.threadsItems)]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_FAILURES_LISTED);
  return {
    needsAttention: input.pipeline + publish + threads,
    breakdown: { pipeline: input.pipeline, publish, threads },
    failures
  };
}

/** "2 stream issues, 1 failed post, 3 failed Threads posts" for a tooltip. */
export function describeBreakdown(breakdown: AttentionBreakdown): string {
  const parts: string[] = [];
  if (breakdown.pipeline > 0) parts.push(`${breakdown.pipeline} stream ${breakdown.pipeline === 1 ? "issue" : "issues"}`);
  if (breakdown.publish > 0) parts.push(`${breakdown.publish} failed ${breakdown.publish === 1 ? "post" : "posts"}`);
  if (breakdown.threads > 0) parts.push(`${breakdown.threads} failed Threads ${breakdown.threads === 1 ? "post" : "posts"}`);
  return parts.join(", ");
}
