"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ClipJob, ClipJobStage } from "@/lib/clipping/types";
import { cn } from "@/lib/utils";

const ACTIVE_POLL_MS = 1_200;
const IDLE_POLL_MS = 5_000;

type ClipJobsContextValue = {
  jobs: ClipJob[];
};

const ClipJobsContext = createContext<ClipJobsContextValue | null>(null);

function isActive(job: ClipJob) {
  return job.status === "queued" || job.status === "processing";
}

/**
 * Keeps clip-generation status alive above the route tree. The generator work
 * already runs server-side; this provider owns the polling so leaving /clips
 * no longer makes its progress disappear.
 */
export function ClipJobsProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<ClipJob[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const controller = new AbortController();

    const poll = async (): Promise<void> => {
      try {
        const response = await fetch("/api/clips", {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw new Error("Could not read clip jobs.");
        const payload = (await response.json()) as { jobs?: ClipJob[] };
        const next = payload.jobs ?? [];
        if (cancelled) return;
        setJobs(next);
        timer = window.setTimeout(poll, next.some(isActive) ? ACTIVE_POLL_MS : IDLE_POLL_MS);
      } catch {
        if (!cancelled) timer = window.setTimeout(poll, IDLE_POLL_MS);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  const value = useMemo(() => ({ jobs }), [jobs]);
  return <ClipJobsContext.Provider value={value}>{children}</ClipJobsContext.Provider>;
}

function useClipJobs() {
  const context = useContext(ClipJobsContext);
  if (!context) throw new Error("useClipJobs must be used within ClipJobsProvider");
  return context;
}

const STAGE_LABELS: Record<ClipJobStage, string> = {
  downloading: "Downloading video",
  analyzing: "Transcribing audio",
  selecting: "Finding the best moments",
  rendering: "Rendering clips",
  finished: "Finishing up"
};

function stageLabel(job: ClipJob) {
  if (job.status === "queued") return "Queued";
  return STAGE_LABELS[job.stage];
}

/**
 * Compact, route-independent progress bar for the newest active generator job.
 * It links back to the Clip Generator and stays pinned at the top-right while
 * the user works elsewhere in the command center.
 */
export function ClipJobProgressIndicator() {
  const { jobs } = useClipJobs();
  const activeJobs = useMemo(
    () =>
      jobs
        .filter(isActive)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [jobs]
  );

  const job = activeJobs[0];
  if (!job) return null;

  const progress = Math.max(0, Math.min(100, Math.round(job.progress)));
  const label = stageLabel(job);

  return (
    <div className="sticky top-4 z-40 mb-4 flex justify-end">
      <Link
        href="/clips"
        aria-label={`Open Clip Generator. ${label}, ${progress}% complete.`}
        className={cn(
          "group w-full max-w-sm overflow-hidden rounded-xl border border-white/10",
          "bg-[#0a0a0c]/95 shadow-[0_14px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl",
          "transition hover:border-white/20"
        )}
      >
        <div className="flex items-center gap-3 px-3.5 pb-2.5 pt-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-3">
              <span className="truncate text-xs font-semibold text-white">{label}</span>
              <span className="shrink-0 font-mono text-xs text-white/70">{progress}%</span>
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-[var(--muted-foreground)]">
              {job.fileName}
              {activeJobs.length > 1 ? ` · +${activeJobs.length - 1} more` : ""}
            </span>
          </span>
        </div>
        <div
          className="h-1 bg-white/[0.06]"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div
            className="h-full rounded-r-full bg-gradient-to-r from-[var(--accent)] via-fuchsia-400 to-cyan-300 shadow-[0_0_14px_var(--accent)] transition-[width] duration-700 ease-out"
            style={{ width: `${Math.max(progress, 2)}%` }}
          />
        </div>
      </Link>
    </div>
  );
}
