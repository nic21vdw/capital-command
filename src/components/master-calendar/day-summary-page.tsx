"use client";

import { useEffect, useMemo, useState } from "react";
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
  Loader2,
  PencilLine,
  Repeat,
  Send
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SourceIcon } from "@/components/master-calendar/source-icon";
import { sourceHrefForDay } from "@/lib/master-calendar/aggregate";
import { formatDayKey, localTodayKey, relativeDayLabel, shiftDayKey } from "@/lib/master-calendar/day-keys";
import { buildDaySummary, summaryState, type DaySummary, type SummaryState } from "@/lib/master-calendar/day-summary";
import { PlatformIcon, type PlatformIconKey } from "@/components/ui/platform-icon";
import {
  eventHref,
  type MasterCalendarEvent,
  type MasterCalendarResponse
} from "@/lib/master-calendar/types";
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
  failed: "Failed"
};

const STATE_TONES: Record<SummaryState, string> = {
  published: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  scheduled: "border-sky-400/30 bg-sky-400/10 text-sky-200",
  pending: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  failed: "border-red-400/30 bg-red-400/10 text-red-200"
};

const STATE_ICONS: Record<SummaryState, typeof CheckCircle2> = {
  published: CheckCircle2,
  scheduled: Send,
  pending: PencilLine,
  failed: AlertTriangle
};

const PLATFORM_ICON_KEYS: Record<string, PlatformIconKey> = {
  YouTube: "youtube",
  Instagram: "instagram",
  TikTok: "tiktok",
  Facebook: "facebook"
};

/** The state tally as a row of chips; zero counts are left out. */
function StateChips({ states, className }: { states: Record<SummaryState, number>; className?: string }) {
  const shown = (["failed", "published", "scheduled", "pending"] as SummaryState[]).filter((state) => states[state] > 0);
  if (shown.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {shown.map((state) => {
        const Icon = STATE_ICONS[state];
        return (
          <Badge key={state} className={cn("gap-1", STATE_TONES[state])}>
            <Icon className="h-3 w-3" />
            {states[state]} {STATE_LABELS[state].toLowerCase()}
          </Badge>
        );
      })}
    </div>
  );
}

/** One scheduled piece: its frame, when it goes, where, and a way in. */
function PieceCard({ event }: { event: MasterCalendarEvent }) {
  const state = summaryState(event.status);
  // A clip that is no longer on this machine 404s its frame, and a broken
  // image reads as "this piece is broken" when only the file has moved.
  const [frameMissing, setFrameMissing] = useState(false);
  return (
    <Link
      href={eventHref(event)}
      className="group flex gap-3 rounded-xl border border-[var(--border)] bg-white/[0.03] p-2.5 transition hover:border-[var(--border-strong)] hover:bg-white/[0.07]"
    >
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
          <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-white">{event.title}</p>
          <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] opacity-0 transition group-hover:opacity-100" />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge className={cn("capitalize", STATE_TONES[state])}>{event.status}</Badge>
          {event.recurring ? (
            <Badge className="gap-1 border-white/10 bg-white/5 text-[var(--muted-foreground)]">
              <Repeat className="h-3 w-3" />
              repeats
            </Badge>
          ) : null}
        </div>
        {event.platforms.length > 0 ? (
          <p className="mt-1.5 truncate text-xs text-[var(--muted-foreground)]">{event.platforms.join(" · ")}</p>
        ) : null}
      </div>
    </Link>
  );
}

/** Everything one surface puts out that day, with a way into that screen. */
function SourceSection({
  section,
  dateKey
}: {
  section: DaySummary["sections"][number];
  dateKey: string;
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
          <PieceCard key={event.id} event={event} />
        ))}
      </div>
    </Card>
  );
}

export function DaySummaryPage({ initialDate }: { initialDate?: string }) {
  const todayKey = useMemo(() => localTodayKey(), []);
  const [dateKey, setDateKey] = useState(initialDate && DATE_KEY_RE.test(initialDate) ? initialDate : todayKey);
  const [response, setResponse] = useState<MasterCalendarResponse | null>(null);
  // The day the latest settled fetch was for; while it trails the chosen day
  // the page is loading, and the previous day's cards stay up to avoid flicker.
  const [fetchedDate, setFetchedDate] = useState<string | null>(null);
  const loading = fetchedDate !== dateKey;

  useEffect(() => {
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

  const relative = relativeDayLabel(dateKey, todayKey);
  const dayLabel = formatDayKey(dateKey, { weekday: "long", month: "long", day: "numeric" });
  const window =
    summary.firstTime && summary.lastTime
      ? summary.firstTime === summary.lastTime
        ? `All at ${summary.firstTime}`
        : `${summary.firstTime} – ${summary.lastTime}`
      : "No fixed times";

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

      <Card className="mb-4 p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center overflow-hidden rounded-lg border border-[var(--border)]">
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
            <span className="flex items-center gap-2 text-sm font-semibold tracking-tight text-white">
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

      <Card className="mb-4">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-sm text-[var(--muted-foreground)]">
              {relative === "Today" || relative === "Tomorrow" || relative === "Yesterday"
                ? `Going out ${relative.toLowerCase()}`
                : `Going out on ${dayLabel}`}
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

      <div className="space-y-4">
        {summary.sections.map((section) => (
          <SourceSection key={section.source.id} section={section} dateKey={dateKey} />
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
