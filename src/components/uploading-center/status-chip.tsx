import { cn } from "@/lib/utils";
import type { PlatformStatus } from "@/lib/publisher/types";

/**
 * The Uploading Center's status colors: draft grey, queued blue, scheduled
 * teal, published green, failed red, manual amber, skipped struck-through
 * grey. "pending" is the queue's word for a post waiting on the runner — the
 * UI calls that "queued".
 */

export type ChipStatus = PlatformStatus | "draft";

const CHIPS: Record<ChipStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "border-white/15 bg-white/8 text-gray-300" },
  pending: { label: "Queued", className: "border-sky-400/30 bg-sky-400/10 text-sky-300" },
  uploaded: { label: "Uploaded", className: "border-indigo-400/30 bg-indigo-400/10 text-indigo-300" },
  scheduled: { label: "Scheduled", className: "border-teal-400/30 bg-teal-400/10 text-teal-300" },
  published: { label: "Published", className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" },
  failed: { label: "Failed", className: "border-red-400/30 bg-red-400/10 text-red-300" },
  manual: { label: "Manual", className: "border-amber-400/30 bg-amber-400/10 text-amber-300" },
  skipped: { label: "Skipped", className: "border-white/15 bg-white/5 text-gray-400 line-through" }
};

export function StatusChip({ status, className }: { status: ChipStatus; className?: string }) {
  const chip = CHIPS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        chip.className,
        className
      )}
    >
      {chip.label}
    </span>
  );
}
