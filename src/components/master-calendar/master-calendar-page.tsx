"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, LayoutList, Loader2, Repeat, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  CALENDAR_SOURCES,
  CALENDAR_SOURCE_BY_ID,
  eventHref,
  type CalendarSource,
  type CalendarSourceId,
  type MasterCalendarEvent,
  type MasterCalendarResponse
} from "@/lib/master-calendar/types";
import type { CalendarPlan } from "@/lib/master-calendar/planner";
import { sourceHrefForDay } from "@/lib/master-calendar/aggregate";
import { formatDayKey, localTodayKey, shiftDayKey, weekdayOfDayKey } from "@/lib/master-calendar/day-keys";
import { SourceIcon } from "@/components/master-calendar/source-icon";
import { cn } from "@/lib/utils";

/** Group a day's events by source, in the canonical CALENDAR_SOURCES order. */
function groupBySource(events: MasterCalendarEvent[]): { source: CalendarSource; events: MasterCalendarEvent[] }[] {
  const bySource = new Map<CalendarSourceId, MasterCalendarEvent[]>();
  for (const event of events) {
    if (!bySource.has(event.source)) bySource.set(event.source, []);
    bySource.get(event.source)!.push(event);
  }
  return CALENDAR_SOURCES.filter((source) => bySource.has(source.id)).map((source) => ({
    source,
    events: bySource.get(source.id)!
  }));
}

/**
 * Master Calendar: every distribution surface — scheduled shorts, carousel
 * schedules, Threads packs, FB/IG thread posts, dated long-form content —
 * on one day/week/month calendar. Events are aggregated server-side by
 * /api/master-calendar; each one links back to the calendar that owns it.
 */

type ViewMode = "day" | "week" | "month";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Sunday of the week containing `key`. */
function startOfWeek(key: string): string {
  return shiftDayKey(key, -weekdayOfDayKey(key));
}

function statusTone(status: string): string {
  if (status === "published" || status === "posted") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  if (status === "failed") return "border-red-400/30 bg-red-400/10 text-red-200";
  if (status === "scheduled") return "border-sky-400/30 bg-sky-400/10 text-sky-200";
  return "";
}

/** A single event as a compact clickable row (month/week cells). */
function EventChip({ event }: { event: MasterCalendarEvent }) {
  const source = CALENDAR_SOURCE_BY_ID[event.source];
  return (
    <Link
      href={eventHref(event)}
      title={`${event.time ? `${event.time} · ` : ""}${event.title} — open ${source.hrefLabel}`}
      className="flex items-center gap-1.5 rounded-md border-l-2 bg-white/5 px-1.5 py-1 text-[11px] leading-tight transition hover:translate-x-0.5 hover:bg-white/10"
      style={{ borderLeftColor: source.color }}
    >
      <SourceIcon source={event.source} className="h-3 w-3" />
      {event.time ? <span className="shrink-0 font-semibold text-[var(--muted-foreground)]">{event.time}</span> : null}
      <span className="min-w-0 truncate text-white">{event.title}</span>
      {event.recurring ? <Repeat className="h-2.5 w-2.5 shrink-0 text-[var(--muted-foreground)]" /> : null}
    </Link>
  );
}

/**
 * A source's events for one day collapsed to a count (e.g. "24 Threads"),
 * expandable in place. The whole point of batch-scheduling is to see at a
 * glance whether the day's pack is ready — not to scroll a 24-item list — so
 * groups of 2+ collapse; a lone event renders inline as its own chip.
 */
function SourceGroupChip({ source, events }: { source: CalendarSource; events: MasterCalendarEvent[] }) {
  const [open, setOpen] = useState(false);
  if (events.length === 1) return <EventChip event={events[0]} />;
  return (
    <div>
      <div
        className="flex w-full items-center gap-1.5 rounded-md border-l-2 bg-white/5 text-[11px] leading-tight"
        style={{ borderLeftColor: source.color }}
      >
        <Link
          href={sourceHrefForDay(source.id, events[0].dateKey)}
          title={`Open ${source.hrefLabel}`}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 transition hover:bg-white/10"
        >
          <SourceIcon source={source.id} className="h-3 w-3" />
          <span className="shrink-0 font-semibold text-white">{events.length}</span>
          <span className="min-w-0 truncate text-[var(--muted-foreground)]">{source.shortLabel}</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          title={open ? `Collapse ${source.shortLabel}` : `Show ${events.length} ${source.shortLabel}`}
          className="shrink-0 px-1 py-1 text-[var(--muted-foreground)] transition hover:text-white"
        >
          <ChevronRight className={cn("h-3 w-3 transition", open && "rotate-90")} />
        </button>
      </div>
      {open ? (
        <div className="mt-1 space-y-1 border-l border-[var(--border)] pl-1.5">
          {events.map((event) => (
            <EventChip key={event.id} event={event} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A single event as a full row with platforms + status (day view). */
function EventCard({ event }: { event: MasterCalendarEvent }) {
  const source = CALENDAR_SOURCE_BY_ID[event.source];
  return (
    <Link
      href={eventHref(event)}
      className="group flex items-center gap-3 rounded-lg border border-[var(--border)] border-l-2 bg-white/5 px-3 py-2.5 transition hover:border-[var(--border-strong)] hover:bg-white/10"
      style={{ borderLeftColor: source.color }}
    >
      <span className="w-12 shrink-0 text-sm font-semibold text-[var(--accent)]">{event.time ?? "—"}</span>
      <SourceIcon source={event.source} className="h-4 w-4" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white">{event.title}</span>
        <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
          {source.shortLabel}
          {event.platforms.length > 0 ? ` · ${event.platforms.join(", ")}` : ""}
        </span>
      </span>
      {event.recurring ? <Repeat className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" /> : null}
      <Badge className={cn("shrink-0 capitalize", statusTone(event.status))}>{event.status}</Badge>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] opacity-0 transition group-hover:opacity-100" />
    </Link>
  );
}

/** Day-view equivalent of SourceGroupChip: a collapsible batch header + rows. */
function SourceGroupCard({ source, events }: { source: CalendarSource; events: MasterCalendarEvent[] }) {
  const [open, setOpen] = useState(false);
  if (events.length === 1) return <EventCard event={events[0]} />;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white/5">
      <div className="flex items-center">
        <Link
          href={sourceHrefForDay(source.id, events[0].dateKey)}
          title={`Open ${source.hrefLabel}`}
          className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left transition hover:bg-white/10"
        >
          <SourceIcon source={source.id} className="h-4 w-4" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-white">
              {events.length} {source.label}
            </span>
            <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
              Open {source.hrefLabel} to manage them
            </span>
          </span>
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
        </Link>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          title={open ? `Collapse ${source.label}` : `Show all ${events.length}`}
          className="shrink-0 px-3 py-2.5 text-[var(--muted-foreground)] transition hover:text-white"
        >
          <ChevronRight className={cn("h-4 w-4 transition", open && "rotate-90")} />
        </button>
      </div>
      {open ? (
        <div className="space-y-1.5 border-t border-[var(--border)] p-1.5">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function MasterCalendarPage() {
  const todayKey = useMemo(() => localTodayKey(), []);
  const [view, setView] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState(todayKey);
  const [hidden, setHidden] = useState<Set<CalendarSourceId>>(new Set());
  const [response, setResponse] = useState<MasterCalendarResponse | null>(null);
  // The range the latest settled fetch was for; while it trails the visible
  // range the calendar is loading (previous events stay up to avoid flicker).
  const [fetchedRange, setFetchedRange] = useState<string | null>(null);
  // AI planner: gap-fill suggestions for the visible window, fetched on demand.
  const [plan, setPlan] = useState<CalendarPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planRange, setPlanRange] = useState<string | null>(null);

  // The window of days the current view needs. A month renders the standard
  // 6-week grid starting on the Sunday before the 1st.
  const range = useMemo(() => {
    if (view === "day") return { start: anchor, days: 1 };
    if (view === "week") return { start: startOfWeek(anchor), days: 7 };
    return { start: startOfWeek(`${anchor.slice(0, 8)}01`), days: 42 };
  }, [view, anchor]);
  const rangeId = `${range.start}:${range.days}`;
  const loading = fetchedRange !== rangeId;

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/master-calendar?start=${range.start}&days=${range.days}`, {
      cache: "no-store",
      signal: controller.signal
    })
      .then((res) => res.json())
      .then((json: MasterCalendarResponse) => {
        setResponse(json);
        setFetchedRange(rangeId);
      })
      .catch((error) => {
        // Settle the range on real errors so the spinner doesn't run forever.
        if (!(error instanceof DOMException && error.name === "AbortError")) setFetchedRange(rangeId);
      });
    return () => controller.abort();
  }, [rangeId, range.start, range.days]);

  const events = useMemo(() => response?.events ?? [], [response]);
  const visibleEvents = useMemo(() => events.filter((event) => !hidden.has(event.source)), [events, hidden]);
  const eventsByDay = useMemo(() => {
    const byDay = new Map<string, MasterCalendarEvent[]>();
    for (const event of visibleEvents) {
      if (!byDay.has(event.dateKey)) byDay.set(event.dateKey, []);
      byDay.get(event.dateKey)!.push(event);
    }
    return byDay;
  }, [visibleEvents]);
  const countsBySource = useMemo(() => {
    const counts = new Map<CalendarSourceId, number>();
    for (const event of events) counts.set(event.source, (counts.get(event.source) ?? 0) + 1);
    return counts;
  }, [events]);

  const shift = (direction: 1 | -1) => {
    setAnchor((current) => {
      if (view === "day") return shiftDayKey(current, direction);
      if (view === "week") return shiftDayKey(current, 7 * direction);
      const [y, m] = current.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1 + direction, 1)).toISOString().slice(0, 10);
    });
  };

  const openDay = (dateKey: string) => {
    setAnchor(dateKey);
    setView("day");
  };

  const toggleSource = (id: CalendarSourceId) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Ask the AI planner to fill gaps in the window currently on screen.
  const runPlan = async () => {
    setPlanning(true);
    try {
      const res = await fetch(`/api/master-calendar/plan?start=${range.start}&days=${range.days}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { plan: CalendarPlan };
      setPlan(json.plan);
      setPlanRange(rangeId);
    } catch {
      // Leave any prior plan up; the button can be pressed again.
    } finally {
      setPlanning(false);
    }
  };
  const planIsStale = plan !== null && planRange !== rangeId;

  /** The calendar source whose colour/link fits a suggestion's kind. */
  const sourceForKind = (kind: CalendarPlan["suggestions"][number]["kind"]) =>
    CALENDAR_SOURCE_BY_ID[kind === "post" ? "x" : kind === "longform" ? "content" : "shorts"];

  const periodLabel = useMemo(() => {
    if (view === "day") return formatDayKey(anchor, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    if (view === "week") {
      const start = startOfWeek(anchor);
      const end = shiftDayKey(start, 6);
      return `${formatDayKey(start, { month: "short", day: "numeric" })} – ${formatDayKey(end, { month: "short", day: "numeric", year: "numeric" })}`;
    }
    return formatDayKey(anchor, { month: "long", year: "numeric" });
  }, [view, anchor]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => shiftDayKey(start, i));
  }, [anchor]);

  const monthDays = useMemo(
    () => Array.from({ length: 42 }, (_, i) => shiftDayKey(startOfWeek(`${anchor.slice(0, 8)}01`), i)),
    [anchor]
  );

  return (
    <div>
      <PageHeader
        eyebrow="Step 4 · Calendar"
        title="Master Calendar"
        description="Every distribution calendar in one place: scheduled shorts uploads, carousel schedules, Threads packs, FB/IG thread posts and dated long-form content — what goes out where, and when."
      />

      {/* Source legend: toggle a source's visibility, or jump into its calendar. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {CALENDAR_SOURCES.map((source) => {
          const isHidden = hidden.has(source.id);
          const count = countsBySource.get(source.id) ?? 0;
          return (
            <div
              key={source.id}
              className={cn(
                "flex items-center overflow-hidden rounded-full border border-[var(--border)] bg-white/5 text-xs transition",
                isHidden && "opacity-45"
              )}
            >
              <button
                type="button"
                onClick={() => toggleSource(source.id)}
                title={isHidden ? `Show ${source.label}` : `Hide ${source.label}`}
                className="flex items-center gap-1.5 py-1.5 pl-2.5 pr-1.5 transition hover:bg-white/10"
              >
                <SourceIcon source={source.id} className="h-3.5 w-3.5" />
                <span className={cn("font-medium text-white", isHidden && "line-through")}>{source.shortLabel}</span>
                <span className="text-[var(--muted-foreground)]">{count}</span>
              </button>
              <Link
                href={source.href}
                title={`Open ${source.hrefLabel}`}
                className="border-l border-[var(--border)] px-1.5 py-1.5 text-[var(--muted-foreground)] transition hover:bg-white/10 hover:text-white"
              >
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          );
        })}
      </div>

      {/* AI planner: fill gaps in the visible window from the idea board. */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--accent)]" />
            <div>
              <p className="text-sm font-semibold text-white">Plan this window</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                Spot scheduling gaps and fill them from your idea board — free, powered by DeepSeek Flash.
              </p>
            </div>
          </div>
          <Button className="h-8 px-3 text-xs" onClick={() => void runPlan()} disabled={planning}>
            {planning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
            {planning ? "Planning…" : plan ? "Re-plan" : "Plan my week"}
          </Button>
        </div>

        {plan ? (
          <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
            <p className="text-xs text-[var(--muted-foreground)]">
              {plan.summary}
              {plan.source === "heuristic" ? " (rule-based)" : ""}
              {planIsStale ? " · Showing a plan for a different window — re-plan to refresh." : ""}
            </p>
            {plan.suggestions.length === 0 ? (
              <p className="text-xs text-[var(--muted-foreground)]">Nothing to add — you&apos;re on cadence for this window.</p>
            ) : (
              <ul className="space-y-1.5">
                {plan.suggestions.map((suggestion, index) => {
                  const source = sourceForKind(suggestion.kind);
                  return (
                    <li
                      key={`${suggestion.dateKey}:${index}`}
                      className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-white/5 px-3 py-2 text-xs"
                    >
                      <SourceIcon source={source.id} className="mt-0.5 h-3.5 w-3.5" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-white">{suggestion.title}</span>
                          <Badge className="border-white/10 bg-white/5 text-[10px] uppercase text-[var(--muted-foreground)]">
                            {suggestion.kind}
                          </Badge>
                        </div>
                        <p className="text-[var(--muted-foreground)]">
                          {suggestion.weekday}, {formatDayKey(suggestion.dateKey, { month: "short", day: "numeric" })} · {suggestion.reason}
                        </p>
                      </div>
                      <Link
                        href={source.href}
                        title={`Open ${source.hrefLabel}`}
                        className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition hover:text-white"
                      >
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}
      </Card>

      <Card className="overflow-hidden p-0">
        {/* Toolbar: period navigation + view switch. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-gradient-to-r from-white/[0.04] to-transparent px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center overflow-hidden rounded-lg border border-[var(--border)]">
              <button
                type="button"
                onClick={() => shift(-1)}
                aria-label="Previous period"
                className="flex h-8 w-8 items-center justify-center text-[var(--muted-foreground)] transition hover:bg-white/10 hover:text-white"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setAnchor(todayKey)}
                className="border-x border-[var(--border)] px-3 text-xs font-medium leading-8 text-[var(--muted-foreground)] transition hover:bg-white/10 hover:text-white"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => shift(1)}
                aria-label="Next period"
                className="flex h-8 w-8 items-center justify-center text-[var(--muted-foreground)] transition hover:bg-white/10 hover:text-white"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <span className="ml-2 flex items-center gap-2 text-sm font-semibold tracking-tight text-white">
              <CalendarDays className="h-4 w-4 text-[var(--accent)]" />
              {periodLabel}
              {visibleEvents.length > 0 ? (
                <Badge className="border-white/10 bg-white/5 text-[10px] text-[var(--muted-foreground)]">
                  {visibleEvents.length} scheduled
                </Badge>
              ) : null}
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--muted-foreground)]" /> : null}
            </span>
          </div>
          <div className="flex rounded-full border border-[var(--border)] bg-white/5 p-0.5">
            {(["day", "week", "month"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-medium capitalize transition-all",
                  view === mode
                    ? "bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_1px_6px_color-mix(in_srgb,var(--accent)_45%,transparent)]"
                    : "text-[var(--muted-foreground)] hover:text-white"
                )}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {view === "month" ? (
          <div className="panel-enter overflow-x-auto">
            <div className="min-w-[840px]">
              <div className="grid grid-cols-7 border-b border-[var(--border)] bg-white/[0.02]">
                {WEEKDAY_LABELS.map((label, index) => (
                  <div
                    key={label}
                    className={cn(
                      "px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider",
                      index === 0 || index === 6 ? "text-[var(--muted-foreground)]/70" : "text-[var(--muted-foreground)]"
                    )}
                  >
                    {label}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {monthDays.map((dateKey, index) => {
                  const dayEvents = eventsByDay.get(dateKey) ?? [];
                  const inMonth = dateKey.slice(0, 7) === anchor.slice(0, 7);
                  const isToday = dateKey === todayKey;
                  const weekend = index % 7 === 0 || index % 7 === 6;
                  return (
                    <div
                      key={dateKey}
                      className={cn(
                        "min-h-[6.5rem] space-y-1 border-[var(--border)] p-1.5 transition-colors",
                        index % 7 !== 0 && "border-l",
                        index >= 7 && "border-t",
                        !inMonth && "opacity-40",
                        isToday ? "bg-[var(--accent)]/8" : weekend && "bg-white/[0.02]"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => openDay(dateKey)}
                        title="Open day view"
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full text-xs transition hover:bg-white/10",
                          isToday
                            ? "bg-[var(--accent)] font-semibold text-[var(--accent-contrast)] shadow-[0_0_10px_color-mix(in_srgb,var(--accent)_50%,transparent)]"
                            : "text-[var(--muted-foreground)] hover:text-white"
                        )}
                      >
                        {Number(dateKey.slice(8, 10))}
                      </button>
                      {groupBySource(dayEvents).map(({ source, events: sourceEvents }) =>
                        sourceEvents.length === 1 ? (
                          <EventChip key={source.id} event={sourceEvents[0]} />
                        ) : (
                          <button
                            key={source.id}
                            type="button"
                            onClick={() => openDay(dateKey)}
                            title={`${sourceEvents.length} ${source.shortLabel} — open day`}
                            className="flex w-full items-center gap-1.5 rounded-md border-l-2 bg-white/5 px-1.5 py-1 text-[11px] leading-tight transition hover:bg-white/10"
                            style={{ borderLeftColor: source.color }}
                          >
                            <SourceIcon source={source.id} className="h-3 w-3" />
                            <span className="shrink-0 font-semibold text-white">{sourceEvents.length}</span>
                            <span className="min-w-0 truncate text-[var(--muted-foreground)]">{source.shortLabel}</span>
                          </button>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        {view === "week" ? (
          <div className="panel-enter overflow-x-auto">
            <div className="grid min-w-[840px] grid-cols-7">
              {weekDays.map((dateKey, index) => {
                const dayEvents = eventsByDay.get(dateKey) ?? [];
                const isToday = dateKey === todayKey;
                return (
                  <div
                    key={dateKey}
                    className={cn(
                      "min-h-[16rem] border-[var(--border)] transition-colors",
                      index > 0 && "border-l",
                      isToday && "bg-[var(--accent)]/5"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => openDay(dateKey)}
                      title="Open day view"
                      className={cn(
                        "flex w-full items-baseline justify-center gap-1.5 border-b border-[var(--border)] px-2 py-2 transition hover:bg-white/5",
                        isToday && "border-b-2 border-b-[var(--accent)]/60 bg-[var(--accent)]/10"
                      )}
                    >
                      <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                        {WEEKDAY_LABELS[weekdayOfDayKey(dateKey)]}
                      </span>
                      <span
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full text-sm",
                          isToday
                            ? "bg-[var(--accent)] font-semibold text-[var(--accent-contrast)] shadow-[0_0_10px_color-mix(in_srgb,var(--accent)_50%,transparent)]"
                            : "text-white"
                        )}
                      >
                        {Number(dateKey.slice(8, 10))}
                      </span>
                    </button>
                    <div className="space-y-1 p-1.5">
                      {groupBySource(dayEvents).map(({ source, events: sourceEvents }) => (
                        <SourceGroupChip key={source.id} source={source} events={sourceEvents} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {view === "day" ? (
          <div className="panel-enter space-y-1.5 p-4">
            <Link
              href={`/day-summary?date=${anchor}`}
              className="mb-2 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white/[0.03] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition hover:bg-white/10 hover:text-white"
            >
              <LayoutList className="h-3.5 w-3.5 text-[var(--accent)]" />
              Read this day as a summary — thumbnails, networks and what still needs doing
              <ArrowUpRight className="ml-auto h-3.5 w-3.5" />
            </Link>
            {groupBySource(eventsByDay.get(anchor) ?? []).map(({ source, events: sourceEvents }) => (
              <SourceGroupCard key={source.id} source={source} events={sourceEvents} />
            ))}
            {(eventsByDay.get(anchor) ?? []).length === 0 && !loading ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <CalendarDays className="h-8 w-8 text-[var(--muted-foreground)]/50" />
                <p className="text-sm text-[var(--muted-foreground)]">Nothing scheduled on this day.</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      {!loading && visibleEvents.length === 0 && view !== "day" ? (
        <Card className="mt-4 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">
            Nothing scheduled in this period yet. Schedule shorts in the{" "}
            <Link href="/uploading-center" className="text-[var(--accent)] hover:underline">
              Uploading Center
            </Link>
            , plan carousels in{" "}
            <Link href="/carousels" className="text-[var(--accent)] hover:underline">
              Carousels
            </Link>
            , generate an{" "}
            <Link href="/x-posts" className="text-[var(--accent)] hover:underline">
              Threads pack
            </Link>{" "}
            or draft{" "}
            <Link href="/facebook" className="text-[var(--accent)] hover:underline">
              FB/IG threads
            </Link>{" "}
            — everything lands here.
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
