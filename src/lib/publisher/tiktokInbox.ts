import type { PublisherConfig } from "@/lib/publisher/config";
import type { QueueItem } from "@/lib/publisher/types";

/**
 * TikTok's inbox flow leaves every clip as an unfinished draft that only a tap
 * in the TikTok app can complete, and TikTok refuses new uploads once too many
 * are waiting — spam_risk_too_many_pending_share. Nothing drains them on a
 * timer, so unlike YouTube's daily allowance this ceiling has no reset: it
 * falls only when the drafts are posted or discarded on the phone.
 *
 * Without it the queue uploads faster than the inbox is emptied, and every
 * TikTok post after the wall is hit is refused.
 */

export function usesTiktokInbox(item: Pick<QueueItem, "tiktok">): boolean {
  return (item.tiktok?.delivery ?? "inbox") !== "direct";
}

export function outstandingTiktokDrafts(items: QueueItem[]): number {
  let waiting = 0;
  for (const item of items) {
    if (!usesTiktokInbox(item)) continue;
    if (item.platforms.tiktok?.status === "scheduled") waiting += 1;
  }
  return waiting;
}

export function remainingTiktokInboxUploads(items: QueueItem[], config: PublisherConfig): number {
  return Math.max(0, config.tiktok.inboxLimit - outstandingTiktokDrafts(items));
}
