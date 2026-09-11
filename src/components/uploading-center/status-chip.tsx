import { cn } from "@/lib/utils";
import { pendingHint, pendingLabel } from "@/lib/publisher/nativeScheduling";
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
  className
}: {
  status: ChipStatus;
  platform?: PlatformId;
  /** The post itself, when there is one: a picture post and a slot beyond
   *  Facebook's 29-day window are both "posts at slot" on a platform that
   *  otherwise takes the upload early. */
  item?: Pick<QueueItem, "mediaKind" | "publishAt">;
  className?: string;
}) {
  const chip = CHIPS[status];
  const label = status === "pending" ? pendingLabel(platform, item) : chip.label;
  return (
    <span
      title={status === "pending" ? pendingHint(platform, item) : undefined}
      className={cn("chip", `tone-${chip.tone}`, className)}
    >
      {label}
    </span>
  );
}
