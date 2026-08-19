import { cn } from "@/lib/utils";
import { pendingHint, pendingLabel } from "@/lib/publisher/nativeScheduling";
import type { PlatformId, PlatformStatus } from "@/lib/publisher/types";

/**
 * The Uploading Center's status colors: draft grey, waiting blue, scheduled
 * teal, published green, failed red, manual amber.
 *
 * "pending" is the queue's word for a post the runner has not delivered yet,
 * and it means two different things. On a platform that takes a post ahead of
 * time it is a few seconds of "uploading"; on Instagram, TikTok and Facebook
 * there is nothing to hand over early, so the post is delivered by this app at
 * its slot and "Queued" reads as if the booking never took. Given the
 * platform, the chip says which one it is.
 */

export type ChipStatus = PlatformStatus | "draft";

const CHIPS: Record<ChipStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "border-white/15 bg-white/8 text-gray-300" },
  pending: { label: "Queued", className: "border-sky-400/30 bg-sky-400/10 text-sky-300" },
  uploaded: { label: "Uploaded", className: "border-indigo-400/30 bg-indigo-400/10 text-indigo-300" },
  scheduled: { label: "Scheduled", className: "border-teal-400/30 bg-teal-400/10 text-teal-300" },
  published: { label: "Published", className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" },
  failed: { label: "Failed", className: "border-red-400/30 bg-red-400/10 text-red-300" },
  manual: { label: "Manual", className: "border-amber-400/30 bg-amber-400/10 text-amber-300" }
};

export function StatusChip({
  status,
  platform,
  className
}: {
  status: ChipStatus;
  platform?: PlatformId;
  className?: string;
}) {
  const chip = CHIPS[status];
  const label = status === "pending" ? pendingLabel(platform) : chip.label;
  return (
    <span
      title={status === "pending" ? pendingHint(platform) : undefined}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        chip.className,
        className
      )}
    >
      {label}
    </span>
  );
}
