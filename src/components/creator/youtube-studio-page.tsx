"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Eye,
  Globe,
  Lock,
  Radio,
  Sparkles,
  Timer,
  TrendingDown,
  TrendingUp,
  Users,
  Youtube
} from "lucide-react";
import { useAppData } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { deriveStudioOverview } from "@/lib/youtube/studio";
import type { StudioVideoRow, StudioVisibility } from "@/lib/youtube/types";
import { cn, formatCurrency } from "@/lib/utils";

const STUDIO_URL = "https://studio.youtube.com";

type RowFilter = "all" | "Video" | "Short" | "Stream" | "Podcast";

const FILTERS: { id: RowFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "Video", label: "Videos" },
  { id: "Short", label: "Shorts" },
  { id: "Stream", label: "Live" },
  { id: "Podcast", label: "Podcasts" }
];

function formatCount(value: number) {
  return new Intl.NumberFormat("en-CA", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatDate(dateString?: string) {
  if (!dateString) return "—";
  const date = new Date(dateString);
  return Number.isNaN(date.getTime()) ? "—" : format(date, "MMM d, yyyy");
}

function VisibilityCell({ visibility }: { visibility: StudioVisibility }) {
  const config = {
    Public: { icon: Globe, label: "Public" },
    Scheduled: { icon: Clock, label: "Scheduled" },
    Draft: { icon: Lock, label: "Draft" }
  }[visibility];
  const Icon = config.icon;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)]">
      <Icon className="h-4 w-4" />
      {config.label}
    </span>
  );
}

function Thumbnail({ row }: { row: StudioVideoRow }) {
  if (row.thumbnailUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={row.thumbnailUrl} alt="" className="h-14 w-24 shrink-0 rounded-lg object-cover" />;
  }
  return (
    <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] text-[var(--muted-foreground)]">
      {row.type === "Stream" ? <Radio className="h-5 w-5" /> : <Youtube className="h-5 w-5" />}
    </div>
  );
}

function PerformanceBadge({ row }: { row: StudioVideoRow }) {
  if (row.performance === "top") {
    return (
      <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
        <TrendingUp className="mr-1 h-3 w-3" />
        Top
      </Badge>
    );
  }
  if (row.performance === "under") {
    return (
      <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-300">
        <TrendingDown className="mr-1 h-3 w-3" />
        Lagging
      </Badge>
    );
  }
  return null;
}

export function YouTubeStudioPage() {
  const { data } = useAppData();
  const currency = data.settings.currency;
  const profile = data.creatorProfile;
  const items = data.contentItems;
  const [filter, setFilter] = useState<RowFilter>("all");

  const overview = useMemo(() => deriveStudioOverview(items, profile), [items, profile]);
  const rows = useMemo(
    () => (filter === "all" ? overview.rows : overview.rows.filter((row) => row.type === filter)),
    [overview.rows, filter]
  );

  const { monetization, insights } = overview;
  const bottleneckLabel =
    monetization.bottleneck === "subscribers"
      ? "Subscribers are the gap to close"
      : monetization.bottleneck === "watchHours"
        ? "Watch hours are the gap to close"
        : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-[var(--accent)]">YouTube Studio</p>
          <h1 className="mt-1 text-3xl font-semibold text-white">
            {overview.channelName || "Your channel"}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted-foreground)]">
            Your posts, monetization, and how each upload is performing. Open YouTube Studio any time for more
            detail.
          </p>
        </div>
        <a href={STUDIO_URL} target="_blank" rel="noreferrer">
          <Button>
            <Youtube className="mr-2 h-4 w-4" />
            Open YouTube Studio
            <ArrowUpRight className="ml-2 h-4 w-4" />
          </Button>
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/8 bg-[var(--panel)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
        <Sparkles className="h-4 w-4 text-[var(--accent)]" />
        {overview.source === "live" ? (
          <span>Live from the YouTube API.</span>
        ) : (
          <span>
            Showing the data you track in Nic Vandewetering. Connect the YouTube API (set{" "}
            <code className="rounded bg-white/10 px-1 py-0.5 text-xs text-white">YOUTUBE_API_KEY</code>) to pull these
            numbers automatically.
          </span>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Subscribers"
          value={formatCount(overview.subscribers)}
          detail={
            monetization.eligible
              ? "Past the 1K threshold"
              : `${formatCount(monetization.subscribersRemaining)} to 1K`
          }
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          label="Total views"
          value={formatCount(overview.totalViews)}
          detail={`${overview.publishedCount} published ${overview.publishedCount === 1 ? "post" : "posts"}`}
          icon={<Eye className="h-5 w-5" />}
        />
        <StatCard
          label="Watch hours"
          value={formatCount(overview.watchHours)}
          detail={
            monetization.eligible
              ? "Past the 4K threshold"
              : `${formatCount(monetization.watchHoursRemaining)} to 4K`
          }
          icon={<Timer className="h-5 w-5" />}
        />
        <StatCard
          label="Revenue this month"
          value={formatCurrency(overview.revenueThisMonth, currency)}
          detail={profile.monetized ? "Channel monetized" : "Not yet monetized"}
          icon={<Youtube className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <Card>
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-white">Monetization readiness</h2>
            <Badge
              className={
                monetization.eligible
                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                  : ""
              }
            >
              {monetization.monetized ? "Monetized" : monetization.eligible ? "Eligible to apply" : "On the path"}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            The Partner Program needs 1,000 subscribers and 4,000 public watch hours in the last 12 months.
          </p>
          <div className="mt-5 space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-[var(--muted-foreground)]">Subscribers</span>
                <span className="text-white">
                  {formatCount(monetization.subscribers)} / {formatCount(monetization.subscriberTarget)}
                </span>
              </div>
              <Progress value={monetization.subscriberPct} />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-[var(--muted-foreground)]">Watch hours</span>
                <span className="text-white">
                  {formatCount(monetization.watchHours)} / {formatCount(monetization.watchHourTarget)}
                </span>
              </div>
              <Progress value={monetization.watchHourPct} />
            </div>
          </div>
          {monetization.eligible ? (
            <div className="mt-5 flex items-start gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Both thresholds are met. You can apply for the Partner Program from YouTube Studio.</span>
            </div>
          ) : (
            <div className="mt-5 space-y-2 rounded-2xl border border-white/8 bg-black/20 p-4 text-sm">
              {bottleneckLabel ? <p className="font-medium text-white">{bottleneckLabel}</p> : null}
              {monetization.projectedWatchHourDate ? (
                <p className="text-[var(--muted-foreground)]">
                  At your recent pace (~{Math.round(monetization.uploadsPerMonth ?? 0)} uploads/mo averaging{" "}
                  {formatCount(monetization.avgWatchHoursPerUpload ?? 0)} watch hours), you reach 4K watch hours around{" "}
                  <span className="text-white">{formatDate(monetization.projectedWatchHourDate)}</span>.
                </p>
              ) : (
                <p className="text-[var(--muted-foreground)]">
                  Add publish dates and watch hours to your posts to project when you&apos;ll cross the thresholds.
                </p>
              )}
            </div>
          )}
        </Card>

        <Card>
          <h2 className="text-xl font-semibold text-white">What&apos;s working</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Measured against your channel&apos;s median views.</p>
          {insights.topPerformers.length === 0 && insights.underPerformers.length === 0 ? (
            <p className="mt-5 text-sm text-[var(--muted-foreground)]">
              Publish a few more posts with view counts and standout performers will surface here.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {insights.topPerformers.length > 0 ? (
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-300">
                    <TrendingUp className="h-3.5 w-3.5" />
                    Top performers
                  </p>
                  <div className="space-y-2">
                    {insights.topPerformers.slice(0, 3).map((row) => (
                      <div key={row.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                        <p className="truncate text-sm font-medium text-white">{row.title}</p>
                        <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                          {formatCount(row.views)} views · {row.performanceReason}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {insights.underPerformers.length > 0 ? (
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-300">
                    <TrendingDown className="h-3.5 w-3.5" />
                    Lagging
                  </p>
                  <div className="space-y-2">
                    {insights.underPerformers.slice(0, 3).map((row) => (
                      <div key={row.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                        <p className="truncate text-sm font-medium text-white">{row.title}</p>
                        <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                          {formatCount(row.views)} views · {row.performanceReason}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </Card>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-white">Channel content</h2>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm transition",
                  filter === option.id
                    ? "bg-white text-black"
                    : "border border-white/10 text-[var(--muted-foreground)] hover:text-white"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <Card className="overflow-hidden p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-[var(--muted-foreground)]">No content here yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-white/8 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                    <th className="px-5 py-3 font-medium">Content</th>
                    <th className="px-5 py-3 font-medium">Visibility</th>
                    <th className="px-5 py-3 font-medium">Date</th>
                    <th className="px-5 py-3 text-right font-medium">Views</th>
                    <th className="px-5 py-3 text-right font-medium">Engagement</th>
                    <th className="px-5 py-3 text-right font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-white/5 transition hover:bg-white/[0.03]">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Thumbnail row={row} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              {row.url ? (
                                <a
                                  href={row.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="truncate font-medium text-white hover:text-[var(--accent)]"
                                >
                                  {row.title}
                                </a>
                              ) : (
                                <span className="truncate font-medium text-white">{row.title}</span>
                              )}
                              <PerformanceBadge row={row} />
                            </div>
                            <p className="mt-1 text-xs text-[var(--muted-foreground)]">{row.type}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <VisibilityCell visibility={row.visibility} />
                      </td>
                      <td className="px-5 py-3 text-sm text-[var(--muted-foreground)]">{formatDate(row.publishDate)}</td>
                      <td className="px-5 py-3 text-right text-sm text-white">
                        {row.views ? formatCount(row.views) : "—"}
                      </td>
                      <td className="px-5 py-3 text-right text-sm text-[var(--muted-foreground)]">
                        {row.views > 0 ? `${(row.engagementRate * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-5 py-3 text-right text-sm text-[var(--muted-foreground)]">
                        {row.revenue ? formatCurrency(row.revenue, currency) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
