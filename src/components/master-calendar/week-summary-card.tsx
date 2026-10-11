"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, Clock, ExternalLink, HandHelping, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PlatformIcon, type PlatformIconKey } from "@/components/ui/platform-icon";
import { SourceIcon } from "@/components/master-calendar/source-icon";
import { formatDayKey } from "@/lib/master-calendar/day-keys";
import { WEEK_VIEWS_LABEL } from "@/lib/master-calendar/viewsCopy";
import { WEEK_PLATFORMS, latestPostLinkLabel, youtubeNoNumbersNote, type WeekPlatformRow, type WeekSummary } from "@/lib/master-calendar/weekSummary";
import { YoutubeAge } from "@/components/publisher/youtube-age";
import { compactCount, type YoutubeStatsStatus } from "@/lib/publisher/youtubeStatsShared";
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

function Counts({ row, className }: { row: Pick<WeekPlatformRow, "published" | "failed" | "byHand" | "scheduled" | "shouldBeLive" | "overdue">; className?: string }) {
  const none = row.published + row.failed + row.byHand + row.scheduled + row.shouldBeLive + row.overdue === 0;
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
          {row.scheduled} still to go
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
  now
}: {
  summary: WeekSummary | null;
  state: "loading" | "ready" | "error";
  statsStatus: YoutubeStatsStatus | "loading";
  now: Date;
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
        className="flex w-full items-center gap-2 px-4 pt-3 text-left"
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
            <div className="rounded-lg border border-[var(--border)] bg-white/[0.03] px-3 py-2.5">
              <p className="text-xs text-[var(--muted-foreground)]">{WEEK_VIEWS_LABEL}</p>
              {yt && yt.videos > 0 ? (
                <p className="mt-1 text-sm text-white">
                  <span className="text-lg font-semibold">{compactCount(yt.views)}</span> {yt.views === 1 ? "view" : "views"} ·{" "}
                  {compactCount(yt.likes)} {yt.likes === 1 ? "like" : "likes"}
                  <span className="text-[var(--muted-foreground)]">
                    {" "}
                    across {yt.videos} {yt.videos === 1 ? "video" : "videos"}
                  </span>
                </p>
              ) : (
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {summary.youtubeTargets.length === 0 && !noNumbers
                    ? "No YouTube videos went out this week."
                    : "No numbers for this week's YouTube videos yet."}
                </p>
              )}
              {noNumbers && (yt?.videos ?? 0) > 0 ? (
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{noNumbers}</p>
              ) : null}
              {yt?.fetchedAt ? (
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  <YoutubeAge status={statsStatus} fetchedAt={yt.fetchedAt} now={now} />
                </p>
              ) : summary.youtubeTargets.length > 0 && statsStatus === "not-connected" ? (
                <p className="mt-1 text-xs">
                  <Link href="/settings#accounts" className="text-[var(--accent)] hover:underline">
                    Connect YouTube to see views here
                  </Link>
                </p>
              ) : null}
              {summary.top ? (
                <div className="mt-2 border-t border-[var(--border)] pt-2">
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Top post · {formatDayKey(summary.top.dateKey, { weekday: "short", month: "short", day: "numeric" })}
                  </p>
                  <p className="mt-0.5 text-sm font-medium leading-snug text-white">{summary.top.title}</p>
                  <p className="mt-0.5 text-xs text-white/80">
                    {compactCount(summary.top.views)} {summary.top.views === 1 ? "view" : "views"}
                    {summary.top.likes !== null ? ` · ${compactCount(summary.top.likes)} ${summary.top.likes === 1 ? "like" : "likes"}` : ""}
                    {summary.top.comments !== null
                      ? ` · ${compactCount(summary.top.comments)} ${summary.top.comments === 1 ? "comment" : "comments"}`
                      : ""}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    <a href={summary.top.watchUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline">
                      Open on YouTube
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    <a href={summary.top.studioUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline">
                      Analytics in Studio
                      <ExternalLink className="h-3 w-3" />
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
