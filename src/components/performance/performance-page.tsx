"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowUp, AtSign, ExternalLink, Info, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ExperimentsSection } from "@/components/performance/experiments-section";
import { SuggestedSlotsCard } from "@/components/performance/suggested-slots-card";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { Select } from "@/components/ui/select";
import type { BestTimesResponse } from "@/lib/analytics/bestTimesApi";
import { cadenceFromSuggestion } from "@/lib/analytics/bestTimesApply";
import { accountOptionKey, defaultAccountKey } from "@/lib/analytics/bestTimesView";
import type { PlatformTotals, PostRow, SortKey } from "@/lib/analytics/query";
import type { AnalyticsReport } from "@/lib/analytics/report";
import { PERFORMANCE_RANGES, PERFORMANCE_SORTS, buildPerformanceSurface, type PerformanceRange } from "@/lib/analytics/surface";
import { ANALYTICS_PLATFORMS, PLATFORM_LABEL, type AnalyticsPlatform, type PostFormat } from "@/lib/analytics/types";
import {
  derivePerformance,
  formatRate,
  sourceLabel,
  sparklinePoints,
  syncStatusLine,
  type DerivedPerformance,
  type NoticeTone,
  type PerformanceView
} from "@/lib/analytics/view";
import { useColateralSurface } from "@/lib/colateral/useSurface";
import type { ExperimentReport } from "@/lib/experiments/evaluate";
import { compactCount } from "@/lib/publisher/youtubeStatsShared";
import { cn } from "@/lib/utils";

const RANGE_LABEL: Record<PerformanceRange, string> = {
  "7d": "Last 7 days",
  "28d": "Last 28 days",
  "90d": "Last 90 days",
  all: "All time"
};

const FORMAT_LABEL: Record<PostFormat, string> = {
  video: "Video",
  "long-form": "Long-form",
  carousel: "Carousel",
  image: "Image",
  text: "Post"
};

const SORT_LABEL: Record<SortKey, string> = {
  published: "Newest",
  views: "Views",
  engagement: "Engagement",
  title: "Title",
  platform: "Platform"
};

const NOTICE_TONE: Record<NoticeTone, BadgeTone> = { danger: "danger", warning: "warning", info: "info" };

const POLL_MS = 3000;
const PAGE_SIZE = 100;
const columnClass = "px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]";

type LoadState = "loading" | "ready" | "error";

function PlatformMark({ platform, className }: { platform: AnalyticsPlatform; className?: string }) {
  if (platform === "threads") return <AtSign className={cn("h-4 w-4", className)} aria-hidden />;
  return <PlatformIcon platform={platform} className={className} />;
}

const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function publishedLabel(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? "-" : shortDate.format(new Date(time));
}

function postName(row: PostRow): string {
  return row.title.trim() || row.caption.trim().slice(0, 90) || "Untitled post";
}

function Sparkline({ values }: { values: number[] }) {
  const points = sparklinePoints(values, 80, 22);
  if (!points) return <span className="text-xs text-[var(--muted-foreground)]">-</span>;
  const rising = values[values.length - 1] >= values[0];
  return (
    <svg viewBox="-1 -1 82 24" className={cn("h-6 w-20", rising ? "tone-success" : "tone-warning")} role="img" aria-label={`${values.length} day trend, ${rising ? "rising" : "falling"}`}>
      <polyline points={points} fill="none" stroke="var(--tone)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function TotalsTile({ totals }: { totals: PlatformTotals }) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-white">
        <PlatformMark platform={totals.platform} className="h-4 w-4 text-[var(--muted-foreground)]" />
        {PLATFORM_LABEL[totals.platform]}
      </p>
      {totals.measured === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          {totals.posts} {totals.posts === 1 ? "post" : "posts"}, not measured yet
        </p>
      ) : (
        <>
          <p className="mt-2 text-3xl font-bold tracking-tight text-white" title={`${totals.views.toLocaleString()} views`}>
            {compactCount(totals.views)} <span className="text-sm font-normal text-[var(--muted-foreground)]">views</span>
          </p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {totals.posts} {totals.posts === 1 ? "post" : "posts"} · {formatRate(totals.engagementRate)} engagement
          </p>
        </>
      )}
    </Card>
  );
}

function TotalsSection({ title, totals }: { title: string; totals: PlatformTotals[] }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2 text-sm font-semibold text-white">{title}</h2>
      {totals.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No posts published in this window.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {totals.map((entry) => (
            <TotalsTile key={entry.platform} totals={entry} />
          ))}
        </div>
      )}
    </section>
  );
}

function PostLink({ row }: { row: PostRow }) {
  const name = postName(row);
  if (!row.url) return <span>{name}</span>;
  return (
    <a href={row.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 hover:text-[var(--accent)] hover:underline">
      <span>{name}</span>
      <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 opacity-60" aria-hidden />
    </a>
  );
}

function TopCards({ rows }: { rows: PostRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label="Top 10 posts">
      <h2 className="mb-2 text-sm font-semibold text-white">Top 10 by views</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {rows.map((row, index) => (
          <Card key={row.key} className="flex flex-col gap-2 p-4">
            <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
              <span className="flex items-center gap-1.5">
                <span className="font-semibold text-white">#{index + 1}</span>
                <PlatformMark platform={row.platform} className="h-3.5 w-3.5" />
                {PLATFORM_LABEL[row.platform]}
              </span>
              <span>{publishedLabel(row.publishedAt)}</span>
            </div>
            <p className="line-clamp-2 text-sm font-medium text-white">
              <PostLink row={row} />
            </p>
            <p className="mt-auto text-xs text-[var(--muted-foreground)]">
              <span className="text-lg font-bold text-white" title={`${(row.metrics.views ?? 0).toLocaleString()} views`}>
                {compactCount(row.metrics.views ?? 0)}
              </span>{" "}
              views · {formatRate(row.engagementRate)} engagement
            </p>
          </Card>
        ))}
      </div>
    </section>
  );
}

function HeaderCell({
  label,
  sort,
  view,
  onSort,
  className
}: {
  label: string;
  sort: SortKey;
  view: PerformanceView;
  onSort: (sort: SortKey) => void;
  className?: string;
}) {
  const active = view.sort === sort;
  return (
    <th className={cn(columnClass, className)} aria-sort={active ? (view.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(sort)}
        className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-white max-sm:min-h-10"
      >
        {label}
        {active ? view.direction === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden /> : null}
      </button>
    </th>
  );
}

function RowTags({ row }: { row: PostRow }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
      {row.format !== "video" ? <Badge className="px-2 py-0.5 text-[11px]">{FORMAT_LABEL[row.format]}</Badge> : null}
      {row.visibility && row.visibility !== "public" ? <Badge className="px-2 py-0.5 text-[11px] capitalize">{row.visibility}</Badge> : null}
      {!row.measured ? (
        <Badge tone={row.status === "unsupported" ? "info" : "warning"} className="px-2 py-0.5 text-[11px]" title={row.note ?? undefined}>
          {row.status === "unsupported" ? "Not measurable" : row.status === "gone" ? "Removed" : "Not read yet"}
        </Badge>
      ) : null}
    </div>
  );
}

function ViewsCell({ row }: { row: PostRow }) {
  return (
    <>
      {row.metrics.views !== undefined ? (
        <span title={`${row.metrics.views.toLocaleString()} views`}>{compactCount(row.metrics.views)}</span>
      ) : (
        <span className="text-[var(--muted-foreground)]">-</span>
      )}
      {row.measured && row.source && /basic/.test(row.source) ? (
        <span className="block text-[10px] text-[var(--muted-foreground)]">{sourceLabel(row.source)}</span>
      ) : null}
    </>
  );
}

function PostsTable({ rows, view, onSort, shown, onMore }: { rows: PostRow[]; view: PerformanceView; onSort: (sort: SortKey) => void; shown: number; onMore: () => void }) {
  if (rows.length === 0) {
    return (
      <Card className="text-center text-sm text-[var(--muted-foreground)]">
        No posts match these filters.
      </Card>
    );
  }
  const visible = rows.slice(0, shown);
  return (
    <Card className="p-0">
      <div data-layout="table" className="hidden sm:block overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead className="border-b border-[var(--border)]">
            <tr>
              <HeaderCell label="Platform" sort="platform" view={view} onSort={onSort} />
              <HeaderCell label="Post" sort="title" view={view} onSort={onSort} />
              <HeaderCell label="Published" sort="published" view={view} onSort={onSort} />
              <HeaderCell label="Views" sort="views" view={view} onSort={onSort} className="text-right" />
              <HeaderCell label="Engagement" sort="engagement" view={view} onSort={onSort} className="text-right" />
              <th className={columnClass}>Trend</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.key} className="border-b border-[var(--border)] last:border-0 align-top">
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-1.5 whitespace-nowrap text-[var(--muted-foreground)]">
                    <PlatformMark platform={row.platform} className="h-3.5 w-3.5" />
                    {PLATFORM_LABEL[row.platform]}
                  </span>
                </td>
                <td className="max-w-md px-3 py-2.5 text-white">
                  <div className="line-clamp-2">
                    <PostLink row={row} />
                  </div>
                  <RowTags row={row} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-[var(--muted-foreground)]">{publishedLabel(row.publishedAt)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-white" title={row.source ? sourceLabel(row.source) : undefined}>
                  <ViewsCell row={row} />
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-white">{formatRate(row.engagementRate)}</td>
                <td className="px-3 py-2.5">
                  <Sparkline values={row.trend} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul data-layout="list" aria-label="Posts" className="divide-y divide-[var(--border)] sm:hidden">
        {visible.map((row) => (
          <li key={row.key} className="px-4 py-3">
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
              <span className="flex items-center gap-1.5">
                <PlatformMark platform={row.platform} className="h-3.5 w-3.5" />
                {PLATFORM_LABEL[row.platform]}
              </span>
              <span>{publishedLabel(row.publishedAt)}</span>
            </div>
            <div className="mt-1 line-clamp-2 text-sm text-white">
              <PostLink row={row} />
            </div>
            <RowTags row={row} />
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
              <span>
                <span className="font-semibold tabular-nums text-white">
                  <ViewsCell row={row} />
                </span>{" "}
                views
              </span>
              <span>
                <span className="font-semibold tabular-nums text-white">{formatRate(row.engagementRate)}</span> engagement
              </span>
              <Sparkline values={row.trend} />
            </div>
          </li>
        ))}
      </ul>
      {rows.length > shown ? (
        <div className="border-t border-[var(--border)] p-3 text-center">
          <Button variant="secondary" onClick={onMore}>
            Show more ({rows.length - shown} left)
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

export function PerformanceBody({
  derived,
  view,
  shown,
  onSort,
  onPlatform,
  onRange,
  onMore,
  empty,
  extras
}: {
  derived: DerivedPerformance;
  view: PerformanceView;
  shown: number;
  onSort: (sort: SortKey) => void;
  onPlatform: (platform: PerformanceView["platform"]) => void;
  onRange: (range: PerformanceRange) => void;
  onMore: () => void;
  empty: boolean;
  extras?: ReactNode;
}) {
  const { rows, top, totals } = derived;
  return (
    <div className="space-y-6">
      <TotalsSection title="Last 7 days" totals={totals.last7} />
      <TotalsSection title="Last 28 days" totals={totals.last28} />
      <TopCards rows={top} />
      {extras}

      <section aria-label="All posts">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-semibold text-white">
            Posts <span className="font-normal text-[var(--muted-foreground)]">({rows.length})</span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Platform">
              {(["all", ...ANALYTICS_PLATFORMS] as const).map((platform) => (
                <button
                  key={platform}
                  type="button"
                  aria-pressed={view.platform === platform}
                  onClick={() => onPlatform(platform)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition max-sm:min-h-10",
                    view.platform === platform
                      ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white"
                      : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-white/10 hover:text-white"
                  )}
                >
                  {platform === "all" ? null : <PlatformMark platform={platform} className="h-3.5 w-3.5" />}
                  {platform === "all" ? "All" : PLATFORM_LABEL[platform]}
                </button>
              ))}
            </div>
            <label className="sr-only" htmlFor="performance-sort">
              Sort by
            </label>
            <Select
              id="performance-sort"
              value={view.sort}
              onChange={(event) => onSort(event.target.value as SortKey)}
              className="h-9 w-auto min-w-32 text-xs sm:hidden"
            >
              {PERFORMANCE_SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {SORT_LABEL[sort]}
                </option>
              ))}
            </Select>
            <label className="sr-only" htmlFor="performance-range">
              Published
            </label>
            <Select
              id="performance-range"
              value={view.range}
              onChange={(event) => onRange(event.target.value as PerformanceRange)}
              className="h-9 w-auto min-w-36 text-xs"
            >
              {PERFORMANCE_RANGES.map((range) => (
                <option key={range} value={range}>
                  {RANGE_LABEL[range]}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <PostsTable rows={rows} view={view} onSort={onSort} shown={shown} onMore={onMore} />
        {empty ? (
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">
            Nothing has been measured yet. The first sync runs a couple of minutes after the app starts, then every 6 hours; press Sync now to run it
            straight away.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function Notices({ notices }: { notices: DerivedPerformance["notices"] }) {
  if (notices.length === 0) return null;
  return (
    <ul className="mb-4 space-y-2" aria-label="Accounts that need attention">
      {notices.map((notice) => (
        <li key={`${notice.platform}:${notice.accountId}:${notice.text}`}>
          <Card className={cn("flex items-start gap-3 p-3 text-sm", `tone-${NOTICE_TONE[notice.tone]} tone-edge border`)}>
            {notice.tone === "info" ? (
              <Info className="mt-0.5 h-4 w-4 shrink-0 tone-text" aria-hidden />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 tone-text" aria-hidden />
            )}
            <span className="text-white">
              {notice.text}
              {notice.tone === "danger" ? (
                <>
                  {" "}
                  <Link href="/settings#accounts" className="underline underline-offset-2">
                    Reconnect
                  </Link>
                </>
              ) : null}
            </span>
          </Card>
        </li>
      ))}
    </ul>
  );
}

const DEFAULT_VIEW: PerformanceView = { platform: "all", range: "28d", sort: "published", direction: "desc" };

function defaultDirection(sort: SortKey): PerformanceView["direction"] {
  return sort === "title" || sort === "platform" ? "asc" : "desc";
}

export function PerformancePage() {
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [view, setView] = useState<PerformanceView>(DEFAULT_VIEW);
  const [shown, setShown] = useState(PAGE_SIZE);
  const wantsAll = view.range === "all";
  const wasRunning = useRef(false);
  const [reloads, setReloads] = useState(0);
  const reload = useCallback(() => setReloads((count) => count + 1), []);
  const [experiments, setExperiments] = useState<{ state: LoadState; reports: ExperimentReport[] }>({ state: "loading", reports: [] });
  const [bestTimes, setBestTimes] = useState<{ state: LoadState; report: BestTimesResponse | null }>({ state: "loading", report: null });
  const [slotsTarget, setSlotsTarget] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/analytics${wantsAll ? "" : "?since=90d"}`, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<AnalyticsReport>;
      })
      .then((body) => {
        setReport(body);
        setState("ready");
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState((current) => (current === "ready" ? current : "error"));
      });
    return () => controller.abort();
  }, [wantsAll, reloads]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/experiments", { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ experiments: ExperimentReport[] }>;
      })
      .then((body) => setExperiments({ state: "ready", reports: body.experiments }))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setExperiments((current) => (current.state === "ready" ? current : { state: "error", reports: [] }));
      });
    return () => controller.abort();
  }, [reloads]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/analytics/best-times", { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<BestTimesResponse>;
      })
      .then((body) => setBestTimes({ state: "ready", report: body }))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setBestTimes((current) => (current.state === "ready" ? current : { state: "error", report: null }));
      });
    return () => controller.abort();
  }, [reloads]);

  const running = report?.sync.running ?? false;
  useEffect(() => {
    if (wasRunning.current && !running) toast.success("Sync finished");
    wasRunning.current = running;
    if (!running) return;
    const timer = setTimeout(reload, POLL_MS);
    return () => clearTimeout(timer);
  }, [running, report, reload]);

  const syncNow = useCallback(async () => {
    try {
      const response = await fetch("/api/analytics/sync", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { started?: boolean; retryAfterSeconds?: number };
      if (response.status === 429) {
        toast.info(`Sync now was used a moment ago. Try again in ${Math.ceil((body.retryAfterSeconds ?? 600) / 60)} min.`);
      } else if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      } else if (body.started === false) {
        toast.info("A sync is already running.");
      } else {
        toast.info("Sync started - this can take a few minutes");
      }
    } catch (error) {
      toast.error(`Could not start the sync: ${error instanceof Error ? error.message : String(error)}`);
    }
    reload();
  }, [reload]);

  const selectedSlots = useMemo(() => {
    const accounts = bestTimes.report?.accounts ?? [];
    return accounts.find((account) => accountOptionKey(account) === slotsTarget) ?? accounts.find((account) => accountOptionKey(account) === defaultAccountKey(accounts)) ?? null;
  }, [bestTimes.report, slotsTarget]);

  const applySuggestedSlots = useCallback(async () => {
    const input = selectedSlots ? cadenceFromSuggestion(selectedSlots) : null;
    if (!input || applying) return false;
    setApplying(true);
    try {
      const response = await fetch("/api/automations/cadence", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      toast.success("Posting times updated. Posts already booked keep the time they have.");
      reload();
      return true;
    } catch (error) {
      toast.error(`Could not change the posting times: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      setApplying(false);
    }
  }, [applying, reload, selectedSlots]);

  const now = useMemo(() => (report ? new Date(report.generatedAt) : new Date(0)), [report]);
  const derived = useMemo(() => (report ? derivePerformance(report, view, now) : null), [report, view, now]);

  const sortBy = useCallback((sort: SortKey) => {
    setView((current) =>
      current.sort === sort
        ? { ...current, direction: current.direction === "asc" ? "desc" : "asc" }
        : { ...current, sort, direction: defaultDirection(sort) }
    );
  }, []);

  const surface = buildPerformanceSurface({
    state,
    report,
    now,
    view,
    shown: derived?.rows.length ?? 0,
    experiments: { ...experiments, timeZone: bestTimes.report?.timeZone },
    slots: { state: bestTimes.state, report: bestTimes.report, target: selectedSlots ? accountOptionKey(selectedSlots) : null, applying }
  });
  useColateralSurface({
    route: "/performance",
    title: "Performance",
    ...surface,
    setField: (id, value) => {
      const text = String(value ?? "");
      if (id === "platform" && (text === "all" || ANALYTICS_PLATFORMS.includes(text as AnalyticsPlatform))) {
        setView((current) => ({ ...current, platform: text as PerformanceView["platform"] }));
        return true;
      }
      if (id === "range" && PERFORMANCE_RANGES.includes(text as PerformanceRange)) {
        setView((current) => ({ ...current, range: text as PerformanceRange }));
        return true;
      }
      if (id === "sort" && PERFORMANCE_SORTS.includes(text as SortKey)) {
        setView((current) => ({ ...current, sort: text as SortKey, direction: defaultDirection(text as SortKey) }));
        return true;
      }
      if (id === "slots-account" && bestTimes.report?.accounts.some((account) => accountOptionKey(account) === text)) {
        setSlotsTarget(text);
        return true;
      }
      return false;
    },
    click: (id) => {
      if (id === "use-slots") {
        if (!selectedSlots || !cadenceFromSuggestion(selectedSlots) || applying) return false;
        void applySuggestedSlots();
        return true;
      }
      if (id !== "sync-now" || running) return false;
      void syncNow();
      return true;
    }
  });

  const status = report ? syncStatusLine(report.sync, now) : state === "error" ? "Could not read the numbers" : "Loading";

  return (
    <div>
      <PageHeader
        eyebrow="Step 4 · Calendar"
        title="Performance"
        description="How every published post performed: views, engagement and trend for YouTube, Instagram, Facebook and Threads. The numbers are read back from each platform every 6 hours."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-[var(--muted-foreground)]" aria-live="polite">
              {status}
            </span>
            <Button variant="secondary" onClick={() => void syncNow()} disabled={running || state === "loading"}>
              {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="mr-2 h-4 w-4" aria-hidden />}
              Sync now
            </Button>
          </div>
        }
      />

      {state === "error" && !report ? (
        <Card className="tone-danger tone-edge border text-sm text-white">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 tone-text" aria-hidden /> The numbers could not be read.
          </p>
          <p className="mt-1 text-[var(--muted-foreground)]">
            Reload the page. If it keeps failing, the file data/analytics/metrics.json may be damaged; move it aside and press Sync now.
          </p>
        </Card>
      ) : null}

      {derived ? <Notices notices={derived.notices} /> : null}

      {state === "loading" && !report ? (
        <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading the numbers
        </div>
      ) : null}

      {report && derived ? (
        <PerformanceBody
          derived={derived}
          view={view}
          shown={shown}
          onSort={sortBy}
          onPlatform={(platform) => {
            setView((current) => ({ ...current, platform }));
            setShown(PAGE_SIZE);
          }}
          onRange={(range) => {
            setView((current) => ({ ...current, range }));
            setShown(PAGE_SIZE);
          }}
          onMore={() => setShown((current) => current + PAGE_SIZE)}
          empty={report.posts.length === 0}
          extras={
            <>
              <SuggestedSlotsCard
                state={bestTimes.state}
                report={bestTimes.report}
                target={selectedSlots ? accountOptionKey(selectedSlots) : null}
                onTarget={setSlotsTarget}
                applying={applying}
                onApply={() => void applySuggestedSlots()}
              />
              <ExperimentsSection state={experiments.state} reports={experiments.reports} timeZone={bestTimes.report?.timeZone ?? "UTC"} />
            </>
          }
        />
      ) : null}
    </div>
  );
}
