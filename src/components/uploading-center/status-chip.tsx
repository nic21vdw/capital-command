import Link from "next/link";
import { cn } from "@/lib/utils";
import { remoteUrlFor } from "@/lib/publisher/remoteUrl";
import {
  isTiktokInboxDraft,
  legInFlight,
  pastSlotMarker,
  manualHint,
  manualLabel,
  pendingHint,
  pendingLabel,
  TIKTOK_INBOX_CHIP,
  TIKTOK_INBOX_HINT
} from "@/lib/publisher/nativeScheduling";
import { youtubeHoldsForReview } from "@/lib/publisher/reviewHold";
import { SCHEDULED_WORD, statusTone, type StatusTone } from "@/lib/statusTone";
import type { PlatformId, PlatformState, PlatformStatus, QueueItem } from "@/lib/publisher/types";

/**
 * The Uploading Center's status colors, in the theme's own tones rather than a
 * fixed Tailwind palette, from the one mapping every screen uses (`statusTone`):
 * draft neutral, queued/scheduled/uploaded info, a post that needs a look
 * (overdue, should be live, needs a connection, post by hand) warning,
 * published success, failed danger.
 *
 * "pending" is the queue's word for a post the runner has not delivered yet,
 * and it means two different things. On a platform that takes a post ahead of
 * time it is a few seconds of "uploading"; on Instagram, TikTok and Facebook
 * there is nothing to hand over early, so the post is delivered by this app at
 * its slot and a bare "Queued" would read as if the booking never took. Given the
 * platform, the chip says which one it is.
 *
 * A TikTok post delivered to the inbox is recorded as "scheduled" too, but it
 * is not done: it is a draft that only a tap in the TikTok app turns into a
 * post. Given the post, the chip says so.
 */

export type ChipStatus = PlatformStatus | "draft";

const CHIPS: Record<ChipStatus, { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: statusTone("draft") },
  pending: { label: SCHEDULED_WORD, tone: statusTone("pending") },
  uploaded: { label: "Uploaded", tone: statusTone("uploaded") },
  scheduled: { label: SCHEDULED_WORD, tone: statusTone("scheduled") },
  published: { label: "Published", tone: statusTone("published") },
  failed: { label: "Failed", tone: statusTone("failed") },
  // Never shown as is: a manual leg's words depend on the slot and the connection (manualLabel).
  manual: { label: "Needs connection", tone: statusTone("needs connection") }
};

export function StatusChip({
  status,
  platform,
  item,
  youtubeQuotaFull,
  connected,
  slotLabel,
  leg,
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
  /** The slot as the screen writes it, for the sentence under the chip ("Tue, Oct 14, 3:00 PM"). */
  slotLabel?: string;
  /**
   * The leg itself, when the chip is for one. With it a pending post whose slot
   * passed reads "Overdue" (linked to Automations) and a scheduled YouTube or
   * Facebook post past its slot reads "Should be live" (see pastSlotMarker).
   */
  leg?: Pick<PlatformState, "postId" | "claimedAt">;
  className?: string;
}) {
  const chip = CHIPS[status];
  const heldPrivate =
    (status === "published" || status === "scheduled") &&
    platform === "youtube" &&
    item != null &&
    youtubeHoldsForReview(item);
  const inboxDraft = isTiktokInboxDraft(platform, status, item);
  const now = new Date();
  const context = {
    youtubeQuotaFull,
    connected,
    inFlight: legInFlight(leg, now),
    formatSlot: slotLabel ? () => slotLabel : undefined
  };
  const marker =
    platform && item && leg && (status === "pending" || status === "scheduled")
      ? pastSlotMarker(platform, { status, postId: leg.postId, claimedAt: leg.claimedAt }, item, now, context)
      : null;
  if (marker) {
    const href = marker.href ?? (platform ? remoteUrlFor(platform, leg?.postId) : null);
    const classes = cn("chip", `tone-${statusTone(marker.label)}`, className);
    const external = marker.href === null;
    return href ? (
      external ? (
        <a href={href} target="_blank" rel="noreferrer" title={marker.hint} className={cn(classes, "underline-offset-2 hover:underline")}>
          {marker.label}
        </a>
      ) : (
        <Link href={href} title={marker.hint} className={cn(classes, "underline-offset-2 hover:underline")}>
          {marker.label}
        </Link>
      )
    ) : (
      <span title={marker.hint} className={classes}>
        {marker.label}
      </span>
    );
  }
  const label =
    status === "pending"
      ? pendingLabel(platform, item, now, context)
      : status === "manual"
        ? manualLabel(platform, item?.publishAt, now, connected)
        : heldPrivate
        ? "Private"
        : inboxDraft
          ? TIKTOK_INBOX_CHIP
          : chip.label;
  // The tone follows the words on the chip, so "Post by hand" or "Needs Instagram
  // connection" is amber whatever status the leg is stored under.
  const tone = heldPrivate ? CHIPS.scheduled.tone : status === "pending" || status === "manual" ? statusTone(label) : chip.tone;
  return (
    <span
      title={
        heldPrivate
          ? "Uploaded private. Make it public on YouTube after you review it."
          : inboxDraft
            ? TIKTOK_INBOX_HINT
            : status === "pending"
              ? pendingHint(platform, item, now, context)
              : status === "manual" && platform
                ? manualHint(platform, label, slotLabel)
                : undefined
      }
      className={cn("chip", `tone-${tone}`, className)}
    >
      {label}
    </span>
  );
}
