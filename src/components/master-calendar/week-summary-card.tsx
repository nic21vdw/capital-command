"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, Clock, ExternalLink, HandHelping, RefreshCw, Send, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PlatformIcon, type PlatformIconKey } from "@/components/ui/platform-icon";
import { SourceIcon } from "@/components/master-calendar/source-icon";
import { formatDayKey } from "@/lib/master-calendar/day-keys";
import { WEEK_VIEWS_LABEL } from "@/lib/master-calendar/viewsCopy";
import { WEEK_PLATFORMS, latestPostLinkLabel, youtubeNoNumbersNote, type WeekPlatformRow, type WeekSummary } from "@/lib/master-calendar/weekSummary";
import { YoutubeAge } from "@/components/publisher/youtube-age";
import { compactCount, percentChangeLabel, type YoutubeStatsStatus } from "@/lib/publisher/youtubeStatsShared";
import { cn } from "@/lib/utils";

/**
 * "Last 7 days": the whole week across networks in one glance. The headline
 * line is always visible; the per-platform rows open under it. On a phone it
 * starts closed (the day below is what you came for), on a desktop it starts
 * open - decided by CSS, so nothing moves once the page has painted. Choosing
 * is remembered only until the page is left.
 */

const ICONS: Partial<Record<WeekPlatformRow["id"], PlatformIconKey>> = {
  youtube: "youtube",
  instagram: "instagram",
  facebook: "facebook",
  tiktok: "tiktok"
};

function Counts({ row, className }: { row: Pick<WeekPlatformRow, "published" | "failed" | "byHand" | "scheduled" | "shouldBeLive" | "overdue" | "needsConnection">; className?: string }) {
  const none = row.published + row.failed + row.byHand + row.scheduled + row.shouldBeLive + row.overdue + row.needsConnection === 0;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {row.published > 0 ? (
        <Badge tone="success" className="gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {row.published} published
        </Badge>
      ) : null}
      {row.failed > 0 ? (
        <Badge tone="danger" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          {row.failed} failed
        </Badge>
      ) : null}
      {row.byHand > 0 ? (
        <Badge tone="warning" className="gap-1">
          <HandHelping className="h-3 w-3" />
          {row.byHand} to post by hand
        </Badge>
      ) : null}
      {row.needsConnection > 0 ? (
        <Badge tone="warning" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          {row.needsConnection} need connection
        </Badge>
      ) : null}
      {row.overdue > 0 ? (
        <Badge tone="warning" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          {row.overdue} overdue
        </Badge>
      ) : null}
      {row.shouldBeLive > 0 ? (
        <Badge tone="warning" className="gap-1">
          <Clock className="h-3 w-3" />
          {row.shouldBeLive} should be live
        </Badge>
      ) : null}
      {row.scheduled > 0 ? (
        <Badge tone="info" className="gap-1">
          <Send className="h-3 w-3" />
          {row.scheduled} scheduled
        </Badge>
      ) : null}
      {none ? <span className="text-xs text-[var(--muted-foreground)]">Nothing this week</span> : null}
    </div>
  );
}

function PlatformRow({ row }: { row: WeekPlatformRow }) {
  const icon = ICONS[row.id];
  const link = row.latest ? (row.latest.url ?? row.latest.href) : null;
  const external = Boolean(row.latest?.url);
  const internalLabel = link && !external ? latestPostLinkLabel(link) : null;
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex w-24 shrink-0 items-center gap-1.5 text-sm font-medium text-white">
          {icon ? <PlatformIcon platform={icon} className="h-3.5 w-3.5" /> : <SourceIcon source="x" className="h-3.5 w-3.5" />}
          {row.label}
        </span>
        <Counts row={row} className="min-w-0 flex-1" />
      </div>
      <p className="mt-1 pl-0 text-xs text-[var(--muted-foreground)] sm:pl-[108px]">
        {row.numbersNote}
        {row.id !== "youtube" && link ? (
          <>
            {" · "}
            {external ? (
              <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline">
                Open latest post
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            ) : (
              <Link href={link} className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline">
                {internalLabel}
                <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            )}
          </>
        ) : null}
      </p>
    </li>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <span className={cn("block animate-pulse rounded bg-white/10", className)} />;
}

export function WeekSummaryCard({
  summary,
  state,
  statsStatus,
  now,
  refreshing = false,
  refreshNote = null,
  onRefresh
}: {
  summary: WeekSummary | null;
  state: "loading" | "ready" | "error";
  statsStatus: YoutubeStatsStatus | "loading";
  now: Date;
  /** The Refresh button's request is in flight. */
  refreshing?: boolean;
  /** What the last Refresh found, in plain words; null until one has been pressed. */
  refreshNote?: { ok: boolean; text: string } | null;
  onRefresh?: () => void;
}) {
  // null = nobody chose yet: closed on a phone, open from 768px up (CSS only).
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen;
  const range = summary
    ? `${formatDayKey(summary.startKey, { month: "short", day: "numeric" })} - ${formatDayKey(summary.endKey, { month: "short", day: "numeric" })}`
    : "";
  const yt = summary?.youtube;
  const noNumbers = yt ? youtubeNoNumbersNote(yt, statsStatus !== "not-connected") : null;

  return (
    <Card className="mb-4 p-0" aria-busy={state === "loading"}>
      <button
        type="button"
        aria-expanded={open ?? undefined}
        aria-controls="week-summary-body"
        onClick={() => {
          const next = !(open ?? (typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches));
          setChosen(next);
        }}
        className="flex w-full items-center gap-2 px-4 pt-3 text-left max-sm:min-h-11"
      >
        <span className="text-sm font-semibold text-white">Last 7 days</span>
        {range ? <span className="text-xs text-[var(--muted-foreground)]">{range}</span> : null}
        <ChevronDown
          className={cn(
            "ml-auto h-4 w-4 text-[var(--muted-foreground)] transition-transform",
            open === true && "rotate-180",
            open === null && "md:rotate-180"
          )}
        />
      </button>

      <div className="min-h-[108px] px-4 pb-3 pt-2 md:min-h-[52px]">
        {state === "loading" ? (
          <div className="space-y-2" role="status">
            <span className="sr-only">Loading the week</span>
            <Skeleton className="h-6 w-2/3" />
          </div>
        ) : state === "error" || !summary ? (
          <p className="text-xs text-[var(--muted-foreground)]">The week could not be loaded. Reload the page to try again.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Counts row={{ ...summary.totals }} />
            {yt && yt.videos > 0 ? (
              <span className="text-sm text-white">
                <span className="font-semibold">{compactCount(yt.views)}</span> YouTube {yt.views === 1 ? "view" : "views"} so far
                <span className="text-[var(--muted-foreground)]">
                  {" "}
                  · {compactCount(yt.likes)} {yt.likes === 1 ? "like" : "likes"}
                </span>
              </span>
            ) : null}
          </div>
        )}
      </div>

      <div
        id="week-summary-body"
        className={cn(
          "border-t border-[var(--border)] px-4 pb-3 pt-3",
          open === true && "block",
          open === false && "hidden",
          open === null && "hidden md:block"
        )}
      >
        {state === "ready" && summary ? (
          <>
            <div className="rounded-lg border border-[var(--border)] bg-white/[0.03] px-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                <p className="min-w-0 flex-1 text-xs text-[var(--muted-foreground)]">{WEEK_VIEWS_LABEL}</p>
                {onRefresh ? (
                  <button
                    type="button"
                    onClick={onRefresh}
                    disabled={refreshing}
                    aria-label="Refresh YouTube numbers"
                    className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white/5 px-3 text-sm font-medium text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-60"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden="true" />
                    {refreshing ? "Refreshing..." : "Refresh"}
                  </button>
                ) : null}
              </div>
              {yt && yt.videos > 0 ? (
                <>
                  <dl className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-3">
                    <div>
                      <dt className="text-xs text-[var(--muted-foreground)]">{yt.views === 1 ? "View" : "Views"}</dt>
                      <dd className="text-3xl font-semibold leading-tight tabular-nums text-white">{compactCount(yt.views)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[var(--muted-foreground)]">{yt.likes === 1 ? "Like" : "Likes"}</dt>
                      <dd className="text-3xl font-semibold leading-tight tabular-nums text-white">{compactCount(yt.likes)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[var(--muted-foreground)]">{yt.videos === 1 ? "Video" : "Videos"}</dt>
                      <dd className="text-3xl font-semibold leading-tight tabular-nums text-white">{yt.videos}</dd>
                    </div>
                  </dl>
                  {summary.trend ? (
                    <p
                      className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm"
                      title="Views so far on this week's videos against views so far on the videos posted the 7 days before. The earlier videos have had longer to earn theirs."
                    >
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 font-semibold",
                          summary.trend.change > 0 ? "text-emerald-300" : summary.trend.change < 0 ? "text-amber-300" : "text-white"
                        )}
                      >
                        {summary.trend.change < 0 ? <TrendingDown className="h-4 w-4" aria-hidden="true" /> : <TrendingUp className="h-4 w-4" aria-hidden="true" />}
                        {percentChangeLabel(summary.trend.percent)} vs previous 7 days
                      </span>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        the {summary.trend.previousVideos} {summary.trend.previousVideos === 1 ? "video" : "videos"} posted before it have {compactCount(summary.trend.previousViews)} views
                      </span>
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {summary.youtubeTargets.length === 0 && !noNumbers
                    ? "No YouTube videos went out this week."
                    : "No numbers for this week's YouTube videos yet."}
                </p>
              )}
              {noNumbers && (yt?.videos ?? 0) > 0 ? (
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">{noNumbers}</p>
              ) : null}
              {yt?.fetchedAt ? (
                <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                  <YoutubeAge status={statsStatus} fetchedAt={yt.fetchedAt} now={now} />
                </p>
              ) : summary.youtubeTargets.length > 0 && statsStatus === "not-connected" ? (
                <p className="mt-2 text-xs">
                  <Link href="/settings#accounts" className="text-[var(--accent)] hover:underline">
                    Connect YouTube to see views here
                  </Link>
                </p>
              ) : null}
              {refreshNote ? (
                <p role="status" className={cn("mt-1 text-xs", refreshNote.ok ? "text-emerald-300" : "text-amber-300")}>
                  {refreshNote.text}
                </p>
              ) : null}
              {summary.top ? (
                <div className="mt-3 border-t border-[var(--border)] pt-3">
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Top post · {formatDayKey(summary.top.dateKey, { weekday: "short", month: "short", day: "numeric" })}
                  </p>
                  <p className="mt-1 text-base font-semibold leading-snug text-white">{summary.top.title}</p>
                  <p className="mt-1 text-sm text-white/90">
                    <span className="font-semibold tabular-nums">{compactCount(summary.top.views)}</span> {summary.top.views === 1 ? "view" : "views"}
                    {summary.top.likes !== null ? ` · ${compactCount(summary.top.likes)} ${summary.top.likes === 1 ? "like" : "likes"}` : ""}
                    {summary.top.comments !== null
                      ? ` · ${compactCount(summary.top.comments)} ${summary.top.comments === 1 ? "comment" : "comments"}`
                      : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a
                      href={summary.top.watchUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[var(--accent)]/60 bg-[var(--accent)]/10 px-3.5 text-sm font-medium text-white hover:bg-[var(--accent)]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    >
                      Watch on YouTube
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                    <a
                      href={summary.top.studioUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white/5 px-3.5 text-sm font-medium text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    >
                      Analytics in Studio
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  </div>
                </div>
              ) : null}
            </div>
            <ul className="mt-1 divide-y divide-[var(--border)]">
              {summary.rows.map((row) => (
                <PlatformRow key={row.id} row={row} />
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
              Counted per platform: one video sent to three networks is three posts. Only YouTube reports views here.
            </p>
          </>
        ) : state === "loading" ? (
          // Roughly the height of the finished body (totals box, five rows), so
          // the day below does not jump when the week lands.
          <div className="space-y-2.5" role="status">
            <span className="sr-only">Loading the week</span>
            <Skeleton className="h-[150px] w-full" />
            {WEEK_PLATFORMS.map((platform) => (
              <Skeleton key={platform.id} className="h-[54px] w-full" />
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
