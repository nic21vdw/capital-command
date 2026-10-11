import { cn } from "@/lib/utils";
import {
  isTiktokInboxDraft,
  pendingHint,
  pendingLabel,
  TIKTOK_INBOX_CHIP,
  TIKTOK_INBOX_HINT
} from "@/lib/publisher/nativeScheduling";
import { youtubeHoldsForReview } from "@/lib/publisher/reviewHold";
import type { PlatformId, PlatformStatus, QueueItem } from "@/lib/publisher/types";

/**
 * The Uploading Center's status colors, in the theme's own tones rather than a
 * fixed Tailwind palette: draft neutral, waiting/scheduled/manual warning,
 * uploaded info, published success, failed danger.
 *
 * "pending" is the queue's word for a post the runner has not delivered yet,
 * and it means two different things. On a platform that takes a post ahead of
 * time it is a few seconds of "uploading"; on Instagram, TikTok and Facebook
 * there is nothing to hand over early, so the post is delivered by this app at
 * its slot and "Queued" reads as if the booking never took. Given the
 * platform, the chip says which one it is.
 *
 * A TikTok post delivered to the inbox is recorded as "scheduled" too, but it
 * is not done: it is a draft that only a tap in the TikTok app turns into a
 * post. Given the post, the chip says so.
 */

export type ChipStatus = PlatformStatus | "draft";

const CHIPS: Record<ChipStatus, { label: string; tone: "neutral" | "warning" | "info" | "success" | "danger" }> = {
  draft: { label: "Draft", tone: "neutral" },
  pending: { label: "Queued", tone: "warning" },
  uploaded: { label: "Uploaded", tone: "info" },
  scheduled: { label: "Scheduled", tone: "warning" },
  published: { label: "Published", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  manual: { label: "Manual", tone: "warning" }
};

export function StatusChip({
  status,
  platform,
  item,
  youtubeQuotaFull,
  connected,
  className
}: {
  status: ChipStatus;
  platform?: PlatformId;
  /** The post itself, when there is one: a picture post and a slot beyond
   *  Facebook's 29-day window are both "posts at slot" on a platform that
   *  otherwise takes the upload early. */
  item?: Pick<QueueItem, "mediaKind" | "publishAt" | "format"> & Partial<Pick<QueueItem, "tiktok">> & { clipPath?: string };
  /** YouTube's upload allowance for today is spent (see PendingContext). */
  youtubeQuotaFull?: boolean;
  /** False when the post's account for this platform has no connection (see PendingContext). */
  connected?: boolean;
  className?: string;
}) {
  const chip = CHIPS[status];
  const heldPrivate =
    (status === "published" || status === "scheduled") &&
    platform === "youtube" &&
    item != null &&
    youtubeHoldsForReview(item);
  const inboxDraft = isTiktokInboxDraft(platform, status, item);
  const context = { youtubeQuotaFull, connected };
  const label =
    status === "pending"
      ? pendingLabel(platform, item, new Date(), context)
      : heldPrivate
        ? "Private"
        : inboxDraft
          ? TIKTOK_INBOX_CHIP
          : chip.label;
  return (
    <span
      title={
        heldPrivate
          ? "Uploaded private. Make it public on YouTube after you review it."
          : inboxDraft
            ? TIKTOK_INBOX_HINT
            : status === "pending"
              ? pendingHint(platform, item, new Date(), context)
              : undefined
      }
      className={cn("chip", `tone-${heldPrivate ? CHIPS.scheduled.tone : chip.tone}`, className)}
    >
      {label}
    </span>
  );
}
