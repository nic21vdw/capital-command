"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Loader2, Repeat, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  CALENDAR_SOURCES,
  CALENDAR_SOURCE_BY_ID,
  type CalendarSourceId,
  type MasterCalendarEvent,
  type MasterCalendarResponse
} from "@/lib/master-calendar/types";
import type { CalendarPlan } from "@/lib/master-calendar/planner";
import { cn } from "@/lib/utils";

/**
 * Master Calendar: every distribution surface — scheduled shorts, carousel
 * schedules, X/Threads packs, FB/IG thread posts, dated long-form content —
 * on one day/week/month calendar. Events are aggregated server-side by
 * /api/master-calendar; each one links back to the calendar that owns it.
 */

type ViewMode = "day" | "week" | "month";

const DAY_MS = 86_400_000;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Calendar-day arithmetic on YYYY-MM-DD keys via UTC ms (never an instant). */
function parseKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

function addDays(key: string, days: number): string {
  return new Date(parseKey(key) + days * DAY_MS).toISOString().slice(0, 10);
}

function weekdayOf(key: string): number {
  return new Date(parseKey(key)).getUTCDay();
}

/** Sunday of the week containing `key`. */
function startOfWeek(key: string): string {
  return addDays(key, -weekdayOf(key));
}

function localTodayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatKey(key: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(parseKey(key)).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
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
      href={source.href}
      title={`${event.time ? `${event.time} · ` : ""}${event.title} — open ${source.hrefLabel}`}
      className="flex items-center gap-1.5 rounded-md bg-white/5 px-1.5 py-1 text-[11px] leading-tight transition hover:bg-white/10"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: source.color }} />
      {event.time ? <span className="shrink-0 font-semibold text-[var(--muted-foreground)]">{event.time}</span> : null}
      <span className="min-w-0 truncate text-white">{event.title}</span>
      {event.recurring ? <Repeat className="h-2.5 w-2.5 shrink-0 text-[var(--muted-foreground)]" /> : null}
    </Link>
  );
}

/** A single event as a full row with platforms + status (day view). */
function EventCard({ event }: { event: MasterCalendarEvent }) {
  const source = CALENDAR_SOURCE_BY_ID[event.source];
  return (
    <Link
      href={source.href}
      className="group flex items-center gap-3 rounded-lg border border-[var(--border)] bg-white/5 px-3 py-2.5 transition hover:border-[var(--border-strong)] hover:bg-white/10"
    >
      <span className="w-12 shrink-0 text-sm font-semibold text-[var(--accent)]">{event.time ?? "—"}</span>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: source.color }} />
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
      if (view === "day") return addDays(current, direction);
      if (view === "week") return addDays(current, 7 * direction);
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
    if (view === "day") return formatKey(anchor, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    if (view === "week") {
      const start = startOfWeek(anchor);
      const end = addDays(start, 6);
      return `${formatKey(start, { month: "short", day: "numeric" })} – ${formatKey(end, { month: "short", day: "numeric", year: "numeric" })}`;
    }
    return formatKey(anchor, { month: "long", year: "numeric" });
  }, [view, anchor]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [anchor]);

  const monthDays = useMemo(
    () => Array.from({ length: 42 }, (_, i) => addDays(startOfWeek(`${anchor.slice(0, 8)}01`), i)),
    [anchor]
  );

  return (
    <div>
      <PageHeader
        eyebrow="Distribute"
        title="Master Calendar"
        description="Every distribution calendar in one place: scheduled shorts uploads, carousel schedules, X/Threads packs, FB/IG thread posts and dated long-form content — what goes out where, and when."
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
                <span className="h-2 w-2 rounded-full" style={{ background: source.color }} />
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
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: source.color }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-white">{suggestion.title}</span>
                          <Badge className="border-white/10 bg-white/5 text-[10px] uppercase text-[var(--muted-foreground)]">
                            {suggestion.kind}
                          </Badge>
                        </div>
                        <p className="text-[var(--muted-foreground)]">
                          {suggestion.weekday}, {formatKey(suggestion.dateKey, { month: "short", day: "numeric" })} · {suggestion.reason}
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

      <Card className="p-0">
        {/* Toolbar: period navigation + view switch. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Button variant="secondary" className="h-8 w-8 p-0" onClick={() => shift(-1)} aria-label="Previous period">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="secondary" className="h-8 px-3" onClick={() => setAnchor(todayKey)}>
              Today
            </Button>
            <Button variant="secondary" className="h-8 w-8 p-0" onClick={() => shift(1)} aria-label="Next period">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="ml-2 flex items-center gap-2 text-sm font-semibold text-white">
              <CalendarDays className="h-4 w-4 text-[var(--accent)]" />
              {periodLabel}
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--muted-foreground)]" /> : null}
            </span>
          </div>
          <div className="flex rounded-lg border border-[var(--border)] p-0.5">
            {(["day", "week", "month"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition",
                  view === mode ? "bg-white/10 text-white" : "text-[var(--muted-foreground)] hover:text-white"
                )}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {view === "month" ? (
          <div className="overflow-x-auto">
            <div className="min-w-[840px]">
              <div className="grid grid-cols-7 border-b border-[var(--border)]">
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label} className="px-2 py-2 text-center text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                    {label}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {monthDays.map((dateKey, index) => {
                  const dayEvents = eventsByDay.get(dateKey) ?? [];
                  const inMonth = dateKey.slice(0, 7) === anchor.slice(0, 7);
                  const isToday = dateKey === todayKey;
                  return (
                    <div
                      key={dateKey}
                      className={cn(
                        "min-h-[6.5rem] space-y-1 border-[var(--border)] p-1.5",
                        index % 7 !== 0 && "border-l",
                        index >= 7 && "border-t",
                        !inMonth && "opacity-40"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => openDay(dateKey)}
                        title="Open day view"
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full text-xs transition hover:bg-white/10",
                          isToday ? "bg-[var(--accent)] font-semibold text-[var(--accent-contrast)]" : "text-[var(--muted-foreground)]"
                        )}
                      >
                        {Number(dateKey.slice(8, 10))}
                      </button>
                      {dayEvents.slice(0, 3).map((event) => (
                        <EventChip key={event.id} event={event} />
                      ))}
                      {dayEvents.length > 3 ? (
                        <button
                          type="button"
                          onClick={() => openDay(dateKey)}
                          className="block w-full rounded-md px-1.5 py-0.5 text-left text-[11px] text-[var(--muted-foreground)] transition hover:bg-white/10 hover:text-white"
                        >
                          +{dayEvents.length - 3} more
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        {view === "week" ? (
          <div className="overflow-x-auto">
            <div className="grid min-w-[840px] grid-cols-7">
              {weekDays.map((dateKey, index) => {
                const dayEvents = eventsByDay.get(dateKey) ?? [];
                const isToday = dateKey === todayKey;
                return (
                  <div key={dateKey} className={cn("min-h-[16rem] border-[var(--border)]", index > 0 && "border-l")}>
                    <button
                      type="button"
                      onClick={() => openDay(dateKey)}
                      title="Open day view"
                      className={cn(
                        "flex w-full items-baseline justify-center gap-1.5 border-b border-[var(--border)] px-2 py-2 transition hover:bg-white/5",
                        isToday && "bg-white/5"
                      )}
                    >
                      <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                        {WEEKDAY_LABELS[weekdayOf(dateKey)]}
                      </span>
                      <span
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full text-sm",
                          isToday ? "bg-[var(--accent)] font-semibold text-[var(--accent-contrast)]" : "text-white"
                        )}
                      >
                        {Number(dateKey.slice(8, 10))}
                      </span>
                    </button>
                    <div className="space-y-1 p-1.5">
                      {dayEvents.map((event) => (
                        <EventChip key={event.id} event={event} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {view === "day" ? (
          <div className="space-y-1.5 p-4">
            {(eventsByDay.get(anchor) ?? []).map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
            {(eventsByDay.get(anchor) ?? []).length === 0 && !loading ? (
              <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">Nothing scheduled on this day.</p>
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
              X/Threads pack
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
