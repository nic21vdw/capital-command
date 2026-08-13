"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ChannelCoverage, CoverageGroup } from "@/lib/ingest/coverage";

const KIND_LABELS: Record<CoverageGroup["kind"], string> = {
  stream: "Live streams",
  upload: "Recorded uploads"
};

function outstandingLine(group: CoverageGroup): string {
  return [
    group.working > 0 ? `${group.working} in the pipeline` : "",
    group.waiting > 0 ? `${group.waiting} not started` : "",
    group.attention > 0 ? `${group.attention} needs you` : ""
  ]
    .filter(Boolean)
    .join(" · ");
}

function scannedAt(iso: string) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const minutes = Math.round((Date.now() - at.getTime()) / 60_000);
  if (minutes < 60) return `scanned ${Math.max(minutes, 1)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `scanned ${hours}h ago`;
  return `scanned ${Math.round(hours / 24)}d ago`;
}

/**
 * How much of the channel the pipeline has caught up with — one row per kind of
 * video, because a week where every stream was handled and no car recording was
 * is a week that reads as "done" on any single number.
 */
export function ChannelCoverageCard({
  coverage,
  onRun,
  starting,
  rescanning,
  onRescan
}: {
  coverage: ChannelCoverage | null;
  onRun: (url: string) => void;
  starting: boolean;
  rescanning: boolean;
  onRescan: () => void;
}) {
  // Until a scan has looked at the channel there is nothing to be behind on —
  // but a screen that simply says nothing leaves no way to ask, and the panel
  // cannot appear on its own before the nightly task next runs.
  if (!coverage || coverage.groups.length === 0) {
    return (
      <Card className="mt-8 flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-xs text-[var(--muted-foreground)]">
          The channel has not been read yet, so nothing here knows what is still to come through the pipeline.
        </p>
        <button
          type="button"
          onClick={onRescan}
          disabled={rescanning}
          className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--muted-foreground)] transition hover:border-[var(--border-strong)] hover:text-white disabled:opacity-50"
        >
          {rescanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Scan the channel
        </button>
      </Card>
    );
  }
  const groups = coverage.groups;
  const behind = groups.some((group) => group.done < group.total);

  return (
    <Card className="mt-8 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">
          {behind ? "Catching up with YouTube" : "Caught up with YouTube"}
        </h2>
        <div className="flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
          <span>
            Last {coverage.lookbackDays} days · {scannedAt(coverage.at)}
          </span>
          <button
            type="button"
            onClick={onRescan}
            disabled={rescanning}
            className="flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 transition hover:border-[var(--border-strong)] hover:text-white disabled:opacity-50"
            title="Read the channel again"
          >
            {rescanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Scan
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {groups.map((group) => {
          const percent = Math.round((group.done / group.total) * 100);
          return (
            <div key={group.kind}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                <span className="text-white/90">{KIND_LABELS[group.kind]}</span>
                <span className="text-[var(--muted-foreground)]">
                  {group.done} of {group.total} through the pipeline
                  {outstandingLine(group) ? ` · ${outstandingLine(group)}` : ""}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/8">
                <div
                  className={cn("h-full rounded-full transition-all", percent === 100 ? "bg-emerald-400/70" : "bg-[var(--accent)]")}
                  style={{ width: `${percent}%` }}
                />
              </div>
              {group.outstanding
                .filter((video) => video.state === "waiting")
                .slice(0, 2)
                .map((video) => (
                  <div key={video.videoId} className="mt-1.5 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--muted-foreground)]">
                      {video.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRun(video.url)}
                      disabled={starting}
                      className="shrink-0 rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)] transition hover:border-[var(--border-strong)] hover:text-white disabled:opacity-50"
                    >
                      Run it
                    </button>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
