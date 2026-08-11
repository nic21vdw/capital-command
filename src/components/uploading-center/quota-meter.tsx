import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { YoutubeQuota } from "@/lib/publisher/quota";

/**
 * Small YouTube quota meter: uploads used today against the self-imposed
 * budget (each upload ≈ 1,600 of the 10,000 default daily units). Turns
 * amber when today's uploads plus everything still queued would blow past
 * the budget — which no longer means anything will be REFUSED by YouTube: the
 * runner stops at the budget and sends the rest after the quota resets.
 */
export function QuotaMeter({ quota }: { quota: YoutubeQuota }) {
  const percent = Math.min(100, (quota.projectedUploads / Math.max(1, quota.budgetUploads)) * 100);
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
      <div className="flex items-center justify-between gap-4 text-xs">
        <span className="font-medium text-white">YouTube quota</span>
        <span className={cn("tabular-nums", quota.overBudget ? "text-amber-300" : "text-[var(--muted-foreground)]")}>
          {quota.uploadsUsed}/{quota.budgetUploads} uploads · {quota.usedUnits.toLocaleString()}/
          {quota.dailyUnits.toLocaleString()} units
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={cn("h-full rounded-full transition-[width]", quota.overBudget ? "bg-amber-400" : "bg-[var(--accent)]")}
          style={{ width: `${percent}%` }}
        />
      </div>
      {quota.overBudget ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {quota.projectedUploads} uploads waiting — past the {quota.budgetUploads}/day budget, so the rest go up over
          the following days rather than in one go.
        </p>
      ) : null}
    </div>
  );
}
