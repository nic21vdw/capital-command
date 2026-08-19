"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronDown, Images, RefreshCw, Video } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PlatformIcon, PLATFORM_LABEL } from "@/components/ui/platform-icon";
import { StatusChip } from "@/components/uploading-center/status-chip";
import type { DaySummary, PlatformRollup } from "@/lib/publisher/daySummary";
import type { PrepInventory } from "@/lib/publisher/prepInventory";
import { cn } from "@/lib/utils";

/**
 * The night-before view: everything going out tomorrow, across all four
 * platforms at once, and what is rendered but still unbooked behind it.
 *
 * The per-platform tabs below this can each look healthy while a whole
 * platform is dead — a post's failed YouTube leg is simply not on the
 * Instagram tab. So this panel leads with the failures rather than the count.
 */

type TomorrowResponse =
  | { enabled: false }
  | { enabled: true; offset: number; summary: DaySummary; prep: PrepInventory };

function PlatformPill({ rollup }: { rollup: PlatformRollup }) {
  const broken = rollup.failed > 0;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2.5 py-1.5",
        broken ? "border-red-400/40 bg-red-400/10" : "border-[var(--border)] bg-white/[0.03]"
      )}
    >
      <PlatformIcon platform={rollup.platform} className="h-4 w-4" />
      <span className="text-xs font-medium text-white">{PLATFORM_LABEL[rollup.platform]}</span>
      <span className={cn("text-xs", broken ? "text-red-300" : "text-[var(--muted-foreground)]")}>
        {broken ? `${rollup.failed} of ${rollup.total} blocked` : `${rollup.total} ready`}
      </span>
    </div>
  );
}

function PostRow({ post }: { post: DaySummary["posts"][number] }) {
  return (
    <div className="flex items-start gap-3 border-t border-[var(--border)] py-2 first:border-t-0">
      <span className="w-11 shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-white">{post.time}</span>
      <span className="shrink-0 pt-0.5 text-[var(--muted-foreground)]">
        {post.mediaKind === "image" ? <Images className="h-3.5 w-3.5" /> : <Video className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-white" title={post.title}>
          {post.title}
          {post.mediaKind === "image" && post.slideCount > 0 ? (
            <span className="ml-1.5 text-[var(--muted-foreground)]">· {post.slideCount} slides</span>
          ) : null}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {post.platforms.map((leg) => (
            <span key={leg.platform} className="inline-flex items-center gap-1" title={leg.error}>
              <PlatformIcon platform={leg.platform} className="h-3 w-3 opacity-70" />
              <StatusChip status={leg.status} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function PrepLine({
  label,
  ready,
  unscheduled,
  titles
}: {
  label: string;
  ready: number;
  unscheduled: number;
  titles: string[];
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white/[0.03] p-3">
      <p className="text-xs font-semibold text-white">{label}</p>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
        {ready} rendered · {unscheduled > 0 ? `${unscheduled} not booked yet` : "all booked"}
      </p>
      {titles.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {titles.slice(0, 4).map((title) => (
            <li key={title} className="truncate text-[11px] text-[var(--muted-foreground)]" title={title}>
              · {title}
            </li>
          ))}
          {titles.length > 4 ? (
            <li className="text-[11px] text-[var(--muted-foreground)]">· and {titles.length - 4} more</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

export function TomorrowSummary() {
  const [data, setData] = useState<TomorrowResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/publish/tomorrow", { cache: "no-store" });
      if (!response.ok) throw new Error(`Tomorrow summary failed (${response.status})`);
      setData((await response.json()) as TomorrowResponse);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load tomorrow's summary");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <Card className="p-4 text-xs text-red-300">
        {error}{" "}
        <button type="button" className="underline" onClick={() => void load()}>
          Try again
        </button>
      </Card>
    );
  }

  if (!data) {
    return <Card className="p-4 text-xs text-[var(--muted-foreground)]">Loading tomorrow…</Card>;
  }

  if (!data.enabled) {
    return <Card className="p-4 text-xs text-[var(--muted-foreground)]">Publishing is off.</Card>;
  }

  const { summary, prep } = data;
  const blocked = summary.platforms.filter((rollup) => rollup.failed > 0);

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <CalendarDays className="h-4 w-4 text-[var(--accent)]" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-white">Tomorrow · {summary.dateLabel}</h2>
          <p className="text-xs text-[var(--muted-foreground)]">
            {summary.totals.posts} post{summary.totals.posts === 1 ? "" : "s"} · {summary.totals.videos} video
            {summary.totals.videos === 1 ? "" : "s"} · {summary.totals.images} carousel
            {summary.totals.images === 1 ? "" : "s"} ({summary.timeZone})
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded p-1 text-[var(--muted-foreground)] hover:text-white"
          aria-label="Refresh tomorrow's summary"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          className="rounded p-1 text-[var(--muted-foreground)] hover:text-white"
          aria-label={open ? "Collapse tomorrow's summary" : "Expand tomorrow's summary"}
          aria-expanded={open}
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} />
        </button>
      </div>

      {blocked.length > 0 ? (
        <div className="mt-3 rounded-lg border border-red-400/40 bg-red-400/10 p-3">
          <p className="flex items-center gap-2 text-xs font-semibold text-red-200">
            <AlertTriangle className="h-3.5 w-3.5" />
            {blocked.map((rollup) => PLATFORM_LABEL[rollup.platform]).join(", ")} will not post tomorrow
          </p>
          {blocked.flatMap((rollup) =>
            rollup.reasons.map((reason) => (
              <p key={`${rollup.platform}:${reason}`} className="mt-1 text-[11px] text-red-200/80">
                {PLATFORM_LABEL[rollup.platform]}: {reason}
              </p>
            ))
          )}
        </div>
      ) : null}

      {open ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.platforms.map((rollup) => (
              <PlatformPill key={rollup.platform} rollup={rollup} />
            ))}
          </div>

          <div className="mt-3">
            {summary.posts.length === 0 ? (
              <p className="text-xs text-[var(--muted-foreground)]">Nothing is booked for tomorrow yet.</p>
            ) : (
              summary.posts.map((post) => <PostRow key={post.id} post={post} />)
            )}
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <PrepLine
              label="Long-form ready to schedule"
              ready={prep.longform.ready}
              unscheduled={prep.longform.unscheduled.length}
              titles={prep.longform.unscheduled.map((entry) => entry.title)}
            />
            <PrepLine
              label="Carousels ready to schedule"
              ready={prep.carousels.rendered}
              unscheduled={prep.carousels.unscheduled.length}
              titles={prep.carousels.unscheduled.map((entry) => entry.title)}
            />
          </div>
        </>
      ) : null}
    </Card>
  );
}
