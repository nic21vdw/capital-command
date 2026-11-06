import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { YoutubeQuota } from "@/lib/publisher/quota";
import type { QuotaPurpose } from "@/lib/youtube/quotaLedger";

const PURPOSE_LABEL: Record<QuotaPurpose, string> = {
  upload: "Uploads",
  analytics: "Analytics",
  inbox: "Inbox",
  "inbox-reply": "Inbox replies",
  listening: "Listening",
  outliers: "Outliers",
  stats: "Stats",
  schedule: "Schedule",
  ingest: "Channel scan",
  channel: "Channel"
};

/**
 * Small YouTube quota meter, read from the shared quota ledger: the day's units
 * split by what spent them, and the uploads the day can still take. Turns amber
 * when today's uploads plus everything still queued would blow past the budget —
 * which no longer means anything will be REFUSED by YouTube: the runner stops
 * at the budget and sends the rest after the quota resets.
 */
export function QuotaMeter({ quota }: { quota: YoutubeQuota }) {
  const uploadUnits = quota.split.find((entry) => entry.purpose === "upload")?.units ?? 0;
  const otherUnits = Math.max(0, quota.usedUnits - uploadUnits);
  const width = (units: number) => `${Math.min(100, (units / Math.max(1, quota.dailyUnits)) * 100)}%`;
  return (
    <div className="glass-inset rounded-lg border px-3 py-2">
      <div className="flex items-center justify-between gap-4 text-xs">
        <span className="font-medium text-white">YouTube quota</span>
        <span className={cn("tabular-nums", quota.overBudget ? "tone-warning tone-text" : "text-[var(--muted-foreground)]")}>
          {`${quota.remainingUploads} ${quota.remainingUploads === 1 ? "upload" : "uploads"} left · ${quota.usedUnits.toLocaleString()}/${quota.dailyUnits.toLocaleString()} units`}
        </span>
      </div>
      <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={cn("h-full transition-[width]", quota.overBudget ? "tone-warning tone-fill" : "bg-[var(--accent)]")}
          style={{ width: width(uploadUnits) }}
        />
        <div className="h-full bg-white/50 transition-[width]" style={{ width: width(otherUnits) }} />
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-[var(--muted-foreground)]">
        {quota.split.map((entry) => (
          <li key={entry.purpose}>
            {`${PURPOSE_LABEL[entry.purpose]} ${entry.units.toLocaleString()}${entry.cap === undefined ? "" : `/${entry.cap.toLocaleString()}`}`}
          </li>
        ))}
      </ul>
      {quota.ledgerReadable ? (
        <p className="mt-1 text-[11px] tabular-nums text-[var(--muted-foreground)]">
          {`${quota.nonUploadSpent.toLocaleString()}/${quota.nonUploadAllowance.toLocaleString()} for everything else`}
        </p>
      ) : (
        <p className="tone-warning tone-text mt-1 flex items-center gap-1.5 text-[11px]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          The quota ledger could not be read, so these numbers come from the upload queue alone.
        </p>
      )}
      {quota.overBudget ? (
        <p className="tone-warning tone-text mt-1.5 flex items-center gap-1.5 text-[11px]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {quota.projectedUploads} uploads waiting — past the {quota.budgetUploads}/day budget, so the rest go up over
          the following days rather than in one go.
        </p>
      ) : null}
    </div>
  );
}
