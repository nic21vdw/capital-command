"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  HandHelping,
  Loader2,
  Lock,
  PencilLine,
  Repeat,
  Send,
  SkipForward
} from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SourceIcon } from "@/components/master-calendar/source-icon";
import { sourceHrefForDay } from "@/lib/master-calendar/aggregate";
import { formatDayKey, localTodayKey, relativeDayLabel, shiftDayKey } from "@/lib/master-calendar/day-keys";
import { buildDaySummary, summaryState, type DaySummary, type SummaryState } from "@/lib/master-calendar/day-summary";
import { buildWeekSummary, WEEK_DAYS } from "@/lib/master-calendar/weekSummary";
import { dayViewsLabel, sameAsWeek } from "@/lib/master-calendar/viewsCopy";
import { YoutubeAge } from "@/components/publisher/youtube-age";
import { YoutubeStatsLine } from "@/components/publisher/youtube-stats-line";
import { WeekSummaryCard } from "@/components/master-calendar/week-summary-card";
import { PlatformIcon, type PlatformIconKey } from "@/components/ui/platform-icon";
import {
  eventHref,
  eventStatusLabel,
  isReminderEventStatus,
  type MasterCalendarEvent,
  type MasterCalendarResponse
} from "@/lib/master-calendar/types";
import { useColateralSurface } from "@/lib/colateral/useSurface";
import { useYoutubeStats, type StatsTarget } from "@/lib/publisher/useYoutubeStats";
import {
  compactCount,
  newestFetchedAt,
  studioAnalyticsUrl,
  totalViews,
  type YoutubeStat
} from "@/lib/publisher/youtubeStatsShared";
import { cn } from "@/lib/utils";

/**
 * Day Summary: the Master Calendar's day, read as a briefing instead of a
 * grid. One day at a time — how many pieces go out, to which networks, in what
 * state, and when — then every piece as a card with a frame of the real file
 * and a way into the screen that owns it.
 */

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const STATE_LABELS: Record<SummaryState, string> = {
  published: "Published",
  scheduled: "Scheduled",
  pending: "In progress",
  skipped: "Skipped",
  failed: "Failed"
};

const STATE_TONES: Record<SummaryState, BadgeTone> = {
  published: "success",
  scheduled: "info",
  pending: "warning",
  skipped: "neutral",
  failed: "danger"
};

const STATE_ICONS: Record<SummaryState, typeof CheckCircle2> = {
  published: CheckCircle2,
  scheduled: Send,
  pending: PencilLine,
  skipped: SkipForward,
  failed: AlertTriangle
};

/** Failed first, then the day's progress; the order every roll-up reads in. */
const STATE_ORDER: SummaryState[] = ["failed", "published", "scheduled", "pending", "skipped"];

const PLATFORM_ICON_KEYS: Record<string, PlatformIconKey> = {
  YouTube: "youtube",
  Instagram: "instagram",
  TikTok: "tiktok",
  Facebook: "facebook"
};

/** The state tally as a row of chips; zero counts are left out. */
function StateChips({ states, className }: { states: Record<SummaryState, number>; className?: string }) {
  const shown = STATE_ORDER.filter((state) => states[state] > 0);
  if (shown.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {shown.map((state) => {
        const Icon = STATE_ICONS[state];
        return (
          <Badge key={state} tone={STATE_TONES[state]} className="gap-1">
            <Icon className="h-3 w-3" />
            {states[state]} {STATE_LABELS[state].toLowerCase()}
          </Badge>
        );
      })}
    </div>
  );
}

/** One scheduled piece: its frame, when it goes, where, and a way in. */
function PieceCard({ event, cachedStat }: { event: MasterCalendarEvent; cachedStat?: YoutubeStat }) {
  const state = summaryState(event.status);
  // A clip that is no longer on this machine 404s its frame, and a broken
  // image reads as "this piece is broken" when only the file has moved.
  const [frameMissing, setFrameMissing] = useState(false);
  // Published YouTube legs carry their video; the numbers are read once per page
  // and shared (see useYoutubeStats).
  const youtube = event.youtube;
  const { stats: youtubeStats, status: youtubeStatus } = useYoutubeStats(youtube ? [youtube] : []);
  // The numbers that rode in with the day's events show at once; the live
  // read replaces them when it lands.
  const youtubeStat = youtube ? (youtubeStats[youtube.videoId] ?? cachedStat) : undefined;
  return (
    // The card is a stretched link (the title's ::before covers it), so the
    // "Open on <platform>" links can sit on top of it without nesting anchors.
    <div className="group relative flex gap-3 rounded-xl border border-[var(--border)] bg-white/[0.03] p-2.5 transition hover:border-[var(--border-strong)] hover:bg-white/[0.07]">
      <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-lg border border-[var(--border)] bg-black/40">
        {event.thumbnailUrl && !frameMissing ? (
          // eslint-disable-next-line @next/next/no-img-element -- local frame from our own route, not a next/image loader
          <img
            src={event.thumbnailUrl}
            alt=""
            loading="lazy"
            onError={() => setFrameMissing(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <SourceIcon source={event.source} className="h-5 w-5 opacity-70" />
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 text-center text-[10px] font-semibold text-white">
          {event.time ?? "All day"}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-white">
            <Link href={eventHref(event)} className="before:absolute before:inset-0 before:rounded-xl before:content-['']">
              {event.title}
            </Link>
          </p>
          <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] opacity-0 transition group-hover:opacity-100" />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge tone={STATE_TONES[state]} className={cn("capitalize", isReminderEventStatus(event.status) && "border-dashed")}>
            {eventStatusLabel(event.status)}
          </Badge>
          {event.recurring ? (
            <Badge className="gap-1 border-white/10 bg-white/5 text-[var(--muted-foreground)]">
              <Repeat className="h-3 w-3" />
              repeats
            </Badge>
          ) : null}
        </div>
        {event.failures && event.failures.length > 0 ? (
          <ul className="relative z-10 mt-1.5 space-y-1.5">
            {event.failures.map((failure, index) => (
              <li key={`${failure.platform}:${index}`} className="flex items-start gap-1 text-xs text-red-300">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="min-w-0">
                  {/* A reason that already names its platform ("Threads connection expired...") needs no prefix. */}
                  {failure.reason.toLowerCase().startsWith(failure.platform.toLowerCase()) ? null : (
                    <span className="font-medium">{failure.platform}: </span>
                  )}
                  {failure.reason}{" "}
                  <Link href={failure.href} className="inline-flex items-center gap-0.5 whitespace-nowrap font-medium text-[var(--accent)] hover:underline">
                    {failure.fixLabel ??
                      (event.failures!.length > 1 ? `Fix ${failure.platform} in Uploading Center` : "Fix in Uploading Center")}
                    <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        ) : event.failedPlatforms && event.failedPlatforms.length > 0 ? (
          <p className="mt-1.5 flex items-start gap-1 text-xs text-red-300">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            Failed on {event.failedPlatforms.join(", ")}
          </p>
        ) : null}
        {event.heldForReview ? (
          <p className="mt-1.5 flex items-start gap-1 text-xs text-amber-300">
            <Lock className="mt-0.5 h-3 w-3 shrink-0" />
            Stays private - publish by hand after review
          </p>
        ) : null}
        {event.platforms.length > 0 ? (
          <p className="mt-1.5 truncate text-xs text-[var(--muted-foreground)]">{event.platforms.join(" · ")}</p>
        ) : null}
        {youtubeStat ? <YoutubeStatsLine stat={youtubeStat} status={youtubeStatus} className="mt-1.5" /> : null}
        {(event.liveLinks && event.liveLinks.length > 0) || youtube ? (
          <div className="relative z-10 mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {(event.liveLinks ?? []).map((link) => (
              <a
                key={link.platform}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
              >
                Open on {link.platform}
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
            {youtube ? (
              <a
                href={studioAnalyticsUrl(youtube.videoId)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
              >
                Analytics in Studio
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Posts nobody can make for him: a platform with no connected account tracks
 * the post as a reminder. They used to be visible only on the Uploading
 * Center, and a toast that fired only while it was open.
 */
function ByHandTodos({ todos }: { todos: DaySummary["todos"] }) {
  if (todos.length === 0) return null;
  return (
    <Card className="mb-4 border-amber-400/30">
      <div className="flex items-center gap-2">
        <HandHelping className="h-4 w-4 text-amber-300" />
        <p className="text-sm font-semibold text-white">
          {todos.length} {todos.length === 1 ? "post" : "posts"} to make by hand
        </p>
      </div>
      <ul className="mt-3 space-y-2">
        {todos.map((todo) => (
          <li
            key={`${todo.eventId}:${todo.platform}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--border)] bg-white/[0.03] px-3 py-2 text-sm"
          >
            <span className="min-w-0 flex-1">
              <span className="font-medium text-white">
                Post by hand on {todo.platform}
                {todo.time ? ` at ${todo.time}` : ""}
              </span>
              <span className="block truncate text-xs text-[var(--muted-foreground)]">{todo.title}</span>
            </span>
            {todo.fileUrl ? (
              <a
                href={todo.fileUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
              >
                Open slides
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
            <Link href={todo.href} className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline">
              Open the post
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Everything one surface puts out that day, with a way into that screen. */
function SourceSection({
  section,
  dateKey,
  cachedStats
}: {
  section: DaySummary["sections"][number];
  dateKey: string;
  cachedStats: Record<string, YoutubeStat>;
}) {
  const { source, events, states } = section;
  return (
    <Card className="overflow-hidden p-0">
      <div
        className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] border-l-2 bg-white/[0.02] px-4 py-3"
        style={{ borderLeftColor: source.color }}
      >
        <SourceIcon source={source.id} className="h-4 w-4" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">
            {events.length} {events.length === 1 ? source.label.replace(/s$/, "") : source.label}
          </p>
          <StateChips states={states} className="mt-1.5" />
        </div>
        <Link
          href={sourceHrefForDay(source.id, dateKey)}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition hover:bg-white/10 hover:text-white"
        >
          Manage in {source.hrefLabel}
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
        {events.map((event) => (
          <PieceCard key={event.id} event={event} cachedStat={event.youtube ? cachedStats[event.youtube.videoId] : undefined} />
        ))}
      </div>
    </Card>
  );
}

/**
 * The day's YouTube numbers. Its space is held from the first paint (a
 * skeleton, then the numbers in the same box) so the cards below never jump
 * when the read lands - it used to pop in above the day after a couple of
 * seconds and push everything down.
 */
function YoutubeDayStrip({
  label,
  dayLoading,
  videoCount,
  totals,
  missing,
  freshness,
  status,
  pending,
  sameAsWeekCard
}: {
  label: string;
  dayLoading: boolean;
  videoCount: number;
  totals: { views: number; likes: number; videos: number };
  missing: boolean;
  freshness: string | null;
  status: ReturnType<typeof useYoutubeStats>["status"];
  pending: boolean;
  /** The day's numbers are the Last 7 days card's own: say so instead of repeating them silently. */
  sameAsWeekCard: boolean;
}) {
  // Nothing went to YouTube that day: nothing to hold space for.
  if (!dayLoading && videoCount === 0) return null;
  const waiting = dayLoading || (totals.videos === 0 && pending);
  const box = "mb-4 min-h-[112px] py-3 sm:min-h-[92px]";
  if (waiting) {
    return (
      <Card className={box} aria-busy="true">
        <p className="text-xs text-[var(--muted-foreground)]">{dayLoading ? "YouTube" : label}</p>
        <p className="mt-2 flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading YouTube numbers...
        </p>
        <span className="mt-3 block h-3 w-2/3 animate-pulse rounded bg-white/10" />
      </Card>
    );
  }
  if (totals.videos === 0) {
    return (
      <Card className={box}>
        <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          No numbers yet for {videoCount === 1 ? "this day's video" : `this day's ${videoCount} videos`}.
          {status === "not-connected" ? (
            <>
              {" "}
              <Link href="/settings#accounts" className="text-[var(--accent)] hover:underline">
                Connect YouTube to see views here
              </Link>
            </>
          ) : null}
        </p>
      </Card>
    );
  }
  return (
    <Card className={box}>
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-1 text-sm text-white">
        <span className="text-lg font-semibold">{compactCount(totals.views)}</span> {totals.views === 1 ? "view" : "views"} ·{" "}
        {compactCount(totals.likes)} {totals.likes === 1 ? "like" : "likes"}
        {missing ? <span className="text-[var(--muted-foreground)]"> (some videos have no numbers yet)</span> : null}
      </p>
      {sameAsWeekCard ? (
        <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
          The same videos and numbers as Last 7 days above - nothing else went out on YouTube this week.
        </p>
      ) : null}
      {freshness ? (
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          <YoutubeAge status={status} fetchedAt={freshness} />
        </p>
      ) : null}
    </Card>
  );
}

/**
 * "Today" is the publish time zone's today, which only the server knows: the
 * calendar API answers with it. A browser in UTC is already on tomorrow for
 * hours every evening, and the rest of the app (queue slots, the Threads board)
 * speaks the publish zone. So the first read decides the day, and the page holds
 * its place until it lands; that read is also the day's data when no other day
 * was asked for, so it is not repeated.
 */
export function DaySummaryPage({ initialDate }: { initialDate?: string }) {
  const [seed, setSeed] = useState<{ today: string; response: MasterCalendarResponse | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const start = initialDate && DATE_KEY_RE.test(initialDate) ? `start=${initialDate}&` : "";
    void fetch(`/api/master-calendar?${start}days=1`, { cache: "no-store", signal: controller.signal })
      .then((res) => res.json())
      .then((json: MasterCalendarResponse) => setSeed({ today: json.today ?? json.start, response: json }))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // The browser's clock is the last resort, only for a server that cannot be asked.
        setSeed({ today: localTodayKey(), response: null });
      });
    return () => controller.abort();
  }, [initialDate]);

  if (!seed) {
    return (
      <div aria-busy="true">
        <PageHeader
          eyebrow="Step 4 · Calendar"
          title="Day Summary"
          description="One day's output as a briefing: everything going out, what state it is in, and a way straight into the screen that owns each piece."
        />
        <Card className="mb-4 h-[58px] animate-pulse bg-white/[0.03]" />
      </div>
    );
  }
  return <DaySummaryBody initialDate={initialDate} todayKey={seed.today} seed={seed.response} />;
}

function DaySummaryBody({
  initialDate,
  todayKey,
  seed
}: {
  initialDate?: string;
  todayKey: string;
  seed: MasterCalendarResponse | null;
}) {
  const [dateKey, setDateKey] = useState(initialDate && DATE_KEY_RE.test(initialDate) ? initialDate : todayKey);
  const [response, setResponse] = useState<MasterCalendarResponse | null>(seed);
  // The day the latest settled fetch was for; while it trails the chosen day
  // the page is loading, and the previous day's cards stay up to avoid flicker.
  const [fetchedDate, setFetchedDate] = useState<string | null>(seed?.start ?? null);
  const seededDay = useRef(seed?.start ?? null);
  const loading = fetchedDate !== dateKey;

  useEffect(() => {
    // The day the page opened on arrived with the seed.
    if (seededDay.current === dateKey) return;
    seededDay.current = null;
    const controller = new AbortController();
    void fetch(`/api/master-calendar?start=${dateKey}&days=1`, { cache: "no-store", signal: controller.signal })
      .then((res) => res.json())
      .then((json: MasterCalendarResponse) => {
        setResponse(json);
        setFetchedDate(dateKey);
      })
      .catch((error) => {
        // Settle the day on real errors so the spinner doesn't run forever.
        if (!(error instanceof DOMException && error.name === "AbortError")) setFetchedDate(dateKey);
      });
    return () => controller.abort();
  }, [dateKey]);

  const summary = useMemo(
    () => buildDaySummary(dateKey, fetchedDate === dateKey ? (response?.events ?? []) : []),
    [dateKey, fetchedDate, response]
  );

  // The last seven days, fetched alongside the day so both paint together.
  const [week, setWeek] = useState<{ state: "loading" | "ready" | "error"; response: MasterCalendarResponse | null }>({
    state: "loading",
    response: null
  });
  useEffect(() => {
    if (!todayKey) return;
    const controller = new AbortController();
    const start = shiftDayKey(todayKey, -(WEEK_DAYS - 1));
    void fetch(`/api/master-calendar?start=${start}&days=${WEEK_DAYS}`, { cache: "no-store", signal: controller.signal })
      .then((res) => res.json())
      .then((json: MasterCalendarResponse) => setWeek({ state: "ready", response: json }))
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setWeek({ state: "error", response: null });
      });
    return () => controller.abort();
  }, [todayKey]);

  // The day's published YouTube videos. PieceCard asks for its own too; the store
  // batches both into one request, and this is what the yesterday strip adds up.
  const youtubeTargets = useMemo<StatsTarget[]>(
    () => summary.sections.flatMap((section) => section.events.flatMap((event) => (event.youtube ? [event.youtube] : []))),
    [summary]
  );
  const weekTargets = useMemo<StatsTarget[]>(
    () => (week.response?.events ?? []).flatMap((event) => (event.youtube ? [event.youtube] : [])),
    [week.response]
  );
  const youtube = useYoutubeStats(useMemo(() => [...youtubeTargets, ...weekTargets], [youtubeTargets, weekTargets]));
  // What the server had cached when it sent the events, under whatever the live
  // read has brought since: numbers are on screen with the cards, not after them.
  const cachedStats = useMemo<Record<string, YoutubeStat>>(
    () => ({ ...week.response?.youtubeStats, ...response?.youtubeStats }),
    [week.response, response]
  );
  const allStats = useMemo(() => ({ ...cachedStats, ...youtube.stats }), [cachedStats, youtube.stats]);
  const youtubeIds = youtubeTargets.map((target) => target.videoId);
  const youtubeTotals = totalViews(allStats, youtubeIds);
  const youtubeMissing = youtubeIds.some((id) => !allStats[id]);
  const weekSummary = useMemo(
    () =>
      week.state === "ready" && week.response
        ? buildWeekSummary({ events: week.response.events, endKey: todayKey, stats: allStats })
        : null,
    [week, todayKey, allStats]
  );

  const relative = relativeDayLabel(dateKey, todayKey);
  // "Friday  Friday, October 9" said the weekday twice; a weekday name already says it.
  const dayLabel = formatDayKey(
    dateKey,
    ["Today", "Tomorrow", "Yesterday"].includes(relative)
      ? { weekday: "long", month: "long", day: "numeric" }
      : { month: "long", day: "numeric" }
  );
  const fullDayLabel = ["Today", "Tomorrow", "Yesterday"].includes(relative) ? dayLabel : `${relative}, ${dayLabel}`;
  const window =
    summary.firstTime && summary.lastTime
      ? summary.firstTime === summary.lastTime
        ? `All at ${summary.firstTime}`
        : `${summary.firstTime} – ${summary.lastTime}`
      : "No fixed times";

  // "N published/scheduled/pending/failed", non-zero states only — the same
  // roll-up StateChips renders, read back as one line for an agent.
  const stateSummary =
    STATE_ORDER.filter((state) => summary.states[state] > 0)
      .map((state) => `${summary.states[state]} ${STATE_LABELS[state].toLowerCase()}`)
      .join(" · ") || "Nothing scheduled";
  const networksSummary =
    summary.platforms.map((platform) => `${platform.label} (${platform.count})`).join(", ") || "None";

  const weekReading = weekSummary
    ? `${weekSummary.totals.published} published, ${weekSummary.totals.failed} failed, ${weekSummary.totals.byHand} to post by hand; YouTube ${weekSummary.youtube.views} views, ${weekSummary.youtube.likes} likes${weekSummary.top ? `; top post "${weekSummary.top.title}" with ${weekSummary.top.views} views` : ""}`
    : "Loading";

  useColateralSurface({
    route: "/day-summary",
    title: "Day Summary",
    summary: "One day's distribution as a briefing: everything going out, what state it is in, and where to manage each piece.",
    fields: [{ id: "date", label: "Date", value: dateKey, kind: "date" }],
    controls: [
      { id: "prev-day", label: "Previous day", group: "Day" },
      { id: "yesterday", label: "Yesterday", group: "Day" },
      { id: "today", label: "Today", group: "Day" },
      { id: "tomorrow", label: "Tomorrow", group: "Day" },
      { id: "next-day", label: "Next day", group: "Day" }
    ],
    readings: [
      { label: "Pieces today", value: String(summary.total) },
      { label: "By state", value: stateSummary },
      { label: "Posting window", value: window },
      { label: "Failed", value: String(summary.states.failed) },
      {
        label: "To post by hand",
        value: summary.todos.map((todo) => `${todo.platform}${todo.time ? ` at ${todo.time}` : ""}: ${todo.title}`).join("; ") || "None"
      },
      { label: "Networks", value: networksSummary },
      { label: "Last 7 days", value: weekReading }
    ],
    setField: (id, value) => {
      if (id !== "date") return false;
      const next = String(value ?? "");
      if (!DATE_KEY_RE.test(next)) return false;
      setDateKey(next);
      return true;
    },
    click: (id) => {
      if (id === "yesterday") {
        setDateKey(shiftDayKey(todayKey, -1));
        return true;
      }
      if (id === "today") {
        setDateKey(todayKey);
        return true;
      }
      if (id === "tomorrow") {
        setDateKey(shiftDayKey(todayKey, 1));
        return true;
      }
      if (id === "prev-day") {
        setDateKey((current) => shiftDayKey(current, -1));
        return true;
      }
      if (id === "next-day") {
        setDateKey((current) => shiftDayKey(current, 1));
        return true;
      }
      return false;
    }
  });

  return (
    <div>
      <PageHeader
        eyebrow="Step 4 · Calendar"
        title="Day Summary"
        description="One day's output as a briefing: everything going out, what state it is in, and a way straight into the screen that owns each piece."
        actions={
          <Link
            href="/master-calendar"
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition hover:bg-white/10 hover:text-white"
          >
            <CalendarRange className="h-3.5 w-3.5" />
            Open Master Calendar
          </Link>
        }
      />
      <p className="-mt-2 mb-4 text-xs text-[var(--muted-foreground)]">
        Shows YouTube views and likes; other platforms show posting status - use the Open on links for their numbers.
      </p>

      <Card className="mb-4 p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex max-w-full items-center overflow-hidden rounded-lg border border-[var(--border)]">
              <button
                type="button"
                onClick={() => setDateKey((current) => shiftDayKey(current, -1))}
                aria-label="Previous day"
                className="flex h-8 w-8 items-center justify-center text-[var(--muted-foreground)] transition hover:bg-white/10 hover:text-white"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setDateKey(shiftDayKey(todayKey, -1))}
                className="border-l border-[var(--border)] px-3 text-xs font-medium leading-8 text-[var(--muted-foreground)] transition hover:bg-white/10 hover:text-white"
              >
                Yesterday
              </button>
              <button
                type="button"
                onClick={() => setDateKey(todayKey)}
                className="border-x border-[var(--border)] px-3 text-xs font-medium leading-8 text-[var(--muted-foreground)] transition hover:bg-white/10 hover:text-white"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setDateKey(shiftDayKey(todayKey, 1))}
                className="border-r border-[var(--border)] px-3 text-xs font-medium leading-8 text-[var(--muted-foreground)] transition hover:bg-white/10 hover:text-white"
              >
                Tomorrow
              </button>
              <button
                type="button"
                onClick={() => setDateKey((current) => shiftDayKey(current, 1))}
                aria-label="Next day"
                className="flex h-8 w-8 items-center justify-center text-[var(--muted-foreground)] transition hover:bg-white/10 hover:text-white"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold tracking-tight text-white">
              <CalendarDays className="h-4 w-4 text-[var(--accent)]" />
              {relative}
              <span className="font-normal text-[var(--muted-foreground)]">{dayLabel}</span>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--muted-foreground)]" /> : null}
            </span>
          </div>
          <input
            type="date"
            value={dateKey}
            onChange={(changed) => {
              if (DATE_KEY_RE.test(changed.target.value)) setDateKey(changed.target.value);
            }}
            className="rounded-lg border border-[var(--border)] bg-white/5 px-2.5 py-1.5 text-xs text-white [color-scheme:dark]"
          />
        </div>
      </Card>

      <WeekSummaryCard summary={weekSummary} state={week.state} statsStatus={youtube.status} now={new Date()} />

      <Card className="mb-4">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-sm text-[var(--muted-foreground)]">
              {relative === "Today" || relative === "Tomorrow" || relative === "Yesterday"
                ? `Going out ${relative.toLowerCase()}`
                : `Going out on ${fullDayLabel}`}
            </p>
            <p className="mt-1 text-4xl font-bold tracking-tight text-white">
              {summary.total} <span className="text-2xl font-semibold">{summary.total === 1 ? "piece" : "pieces"}</span>
            </p>
            <StateChips states={summary.states} className="mt-3" />
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
                <Clock className="h-3.5 w-3.5" />
                Posting window
              </p>
              <p className="mt-1.5 text-lg font-semibold text-white">{window}</p>
              {summary.untimed > 0 ? (
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                  {summary.untimed} without a set time
                </p>
              ) : null}
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Networks</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {summary.platforms.length === 0 ? (
                  <span className="text-sm text-[var(--muted-foreground)]">—</span>
                ) : (
                  summary.platforms.map((platform) => {
                    const icon = PLATFORM_ICON_KEYS[platform.label];
                    return (
                      <span
                        key={platform.label}
                        className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white/5 px-2.5 py-1 text-xs text-white"
                      >
                        {icon ? <PlatformIcon platform={icon} className="h-3.5 w-3.5" /> : null}
                        {platform.label}
                        <span className="font-semibold text-[var(--muted-foreground)]">{platform.count}</span>
                      </span>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {dateKey <= todayKey ? (
        <YoutubeDayStrip
          label={dayViewsLabel(youtubeIds.length, relative, fullDayLabel)}
          dayLoading={loading}
          videoCount={youtubeIds.length}
          totals={youtubeTotals}
          missing={youtubeMissing}
          freshness={newestFetchedAt(allStats, youtubeIds)}
          status={youtube.status}
          pending={youtube.pending}
          sameAsWeekCard={Boolean(weekSummary) && dateKey >= weekSummary!.startKey && sameAsWeek(youtubeTotals, weekSummary!.youtube)}
        />
      ) : null}

      <ByHandTodos todos={summary.todos} />

      <div className="space-y-4">
        {summary.sections.map((section) => (
          <SourceSection key={section.source.id} section={section} dateKey={dateKey} cachedStats={cachedStats} />
        ))}
      </div>

      {summary.total === 0 && !loading ? (
        <Card className="text-center">
          <CalendarDays className="mx-auto h-8 w-8 text-[var(--muted-foreground)]/50" />
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Nothing is scheduled for this day yet — book it in the{" "}
            <Link href="/uploading-center" className="text-[var(--accent)] hover:underline">
              Uploading Center
            </Link>{" "}
            or plan the week on the{" "}
            <Link href="/master-calendar" className="text-[var(--accent)] hover:underline">
              Master Calendar
            </Link>
            .
          </p>
        </Card>
      ) : null}

      {response ? (
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">
          Times shown in {response.timezone}
          {!response.publishEnabled ? " · Shorts publisher is not configured, so scheduled uploads are not included yet." : ""}
        </p>
      ) : null}
    </div>
  );
}
