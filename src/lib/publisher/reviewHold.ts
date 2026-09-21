import type { QueueItem } from "@/lib/publisher/types";

/**
 * A long-form YouTube upload stays private until it is made public by hand.
 * Shorts and reels do not: they still go out on their own schedule.
 *
 * `format` is stamped at enqueue. Rows queued before that field exist, and
 * their long-form files live under data/longform/.
 */
export function youtubeHoldsForReview(
  item: Pick<QueueItem, "format"> & { clipPath?: string }
): boolean {
  if (item.format === "long") return true;
  if (!item.clipPath) return false;
  return item.clipPath.replace(/\\/g, "/").toLowerCase().includes("/longform/");
}
