import { describeFailure } from "@/lib/publisher/failure";
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
 * What counts:
 *  - A publish-queue post with ANY failed leg (YouTube, Instagram, TikTok,
 *    Facebook, or Buffer), not only one where every leg failed.
 *  - Unless it is fully failed AND already on screen (`failedSeenAt`, stamped
 *    when the Uploading Center loads): that is the same "seen" proof the
 *    retention sweep waits for, and a failure he has looked at stops nagging.
 *    A partly failed post is never stamped (queue.test.ts pins that), so it
 *    counts until it is retried or ages out.
 *  - A Threads post whose status is `failed`. The queue keeps no "seen" mark,
 *    so it counts until it is retried or ages out.
 *  - Only failures from the last ATTENTION_WINDOW_DAYS, by their slot: an old
 *    failure that was never cleared is history, not news. Future slots count
 *    (an upload that already failed ahead of its slot still needs a hand).
 *  - "manual" legs do not count. They are reminders, not failures, and they are
 *    listed as to-dos on Day Summary instead.
 */

export const ATTENTION_WINDOW_DAYS = 7;

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

const PLATFORM_ORDER: PlatformId[] = ["youtube", "instagram", "tiktok", "facebook"];

function withinWindow(publishAt: string, now: Date): boolean {
  const slot = new Date(publishAt).getTime();
  if (!Number.isFinite(slot)) return false;
  return slot >= now.getTime() - ATTENTION_WINDOW_DAYS * 86_400_000;
}

function isFullyFailed(item: QueueItem): boolean {
  const states = Object.values(item.platforms);
  return states.length > 0 && states.every((state) => state?.status === "failed") && (!item.buffer || item.buffer.status === "failed");
}

/** True when this queue post is asking for attention. */
export function publishNeedsAttention(item: QueueItem, now: Date): boolean {
  if (!withinWindow(item.publishAt, now)) return false;
  const failedLeg =
    Object.values(item.platforms).some((state) => state?.status === "failed") || item.buffer?.status === "failed";
  if (!failedLeg) return false;
  return !(isFullyFailed(item) && item.failedSeenAt);
}

function shortTitle(text: string, max = 80): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** The failing posts, one entry per failed leg, newest slot first. */
export function publishFailures(queue: QueueItem[], now: Date): AttentionFailure[] {
  const failures: AttentionFailure[] = [];
  for (const item of queue) {
    if (!publishNeedsAttention(item, now)) continue;
    for (const platform of PLATFORM_ORDER) {
      const state = item.platforms[platform];
      if (!state || state.status !== "failed") continue;
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
        // `attempts` moves on every failed try, so a post that is retried and
        // fails again is a new event while an unchanged failure keeps its id
        // and the host can dedupe it.
        id: `publish-failed:${item.id}:${platform}:${state.attempts ?? 0}`,
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

/** Posts (not legs) in the publish queue asking for attention. */
export function countPublishAttention(queue: QueueItem[], now: Date): number {
  return queue.filter((item) => publishNeedsAttention(item, now)).length;
}

const THREADS_CONNECTION = /reconnect|expired|revoked|unauthoriz|unauthentic|invalid.*token|\b401\b|\b190\b/i;

/** Failed Threads posts inside the window. */
export function threadsFailedItems(items: ThreadsQueueItem[], now: Date): ThreadsQueueItem[] {
  return items.filter((item) => item.status === "failed" && withinWindow(item.publishAt, now));
}

export function threadsFailures(items: ThreadsQueueItem[], now: Date): AttentionFailure[] {
  return threadsFailedItems(items, now)
    .map((item): AttentionFailure => {
      const reconnect = Boolean(item.error && THREADS_CONNECTION.test(item.error));
      return {
        kind: "threads",
        id: `threads-failed:${item.id}:${item.attempts ?? 0}`,
        level: "error",
        title: "A Threads post failed",
        body: `"${shortTitle(item.topic || item.text || "Untitled post")}": ${
          reconnect
            ? "The Threads connection expired or was revoked. Reconnect it in Settings, then retry the post."
            : "Threads would not take this post. Open Threads Posts and retry it."
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
  now: Date;
}): { needsAttention: number; breakdown: AttentionBreakdown; failures: AttentionFailure[] } {
  const publish = countPublishAttention(input.queue, input.now);
  const threads = threadsFailedItems(input.threadsItems, input.now).length;
  const failures = [...publishFailures(input.queue, input.now), ...threadsFailures(input.threadsItems, input.now)]
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
