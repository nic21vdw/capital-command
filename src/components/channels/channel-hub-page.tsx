"use client";

import { useEffect, useMemo, useState, type ComponentType, type CSSProperties } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  AtSign,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Facebook,
  Images,
  Instagram,
  Loader2,
  MessageSquareText,
  Music4,
  Repeat,
  Wand2,
  Youtube
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  CHANNELS,
  CHANNEL_KIND_LABELS,
  channelKindOf,
  countByKind,
  kindHref,
  type ChannelId,
  type ChannelKind,
  type ChannelResponse
} from "@/lib/channels/platforms";
import type { MasterCalendarEvent } from "@/lib/master-calendar/types";
import { cn } from "@/lib/utils";

/**
 * Channel Hub: everything already scheduled for ONE network, on one screen.
 *
 * It is a reading surface, not a second editor — every row links back to the
 * Uploading Center, Carousels or Threads Posts where that item is actually
 * managed. The value is the narrowing: the Master Calendar answers "what goes
 * out this week", this answers "what does my TikTok look like".
 */

/** Icon components accept the same className/style lucide icons do. */
type IconComponent = ComponentType<{ className?: string; style?: CSSProperties }>;

const CHANNEL_ICONS: Record<ChannelId, IconComponent> = {
  youtube: Youtube,
  instagram: Instagram,
  tiktok: Music4,
  facebook: Facebook,
  threads: AtSign
};

const KIND_ICONS: Record<ChannelKind, IconComponent> = {
  short: Wand2,
  longform: Clapperboard,
  carousel: Images,
  text: MessageSquareText
};

type ViewMode = "week" | "month" | "list";

const DAY_MS = 86_400_000;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
  if (status === "skipped") return "border-white/10 bg-white/5 text-[var(--muted-foreground)] line-through";
  return "";
}

/** A post as a compact chip, tinted by what kind of thing it is. */
function EventChip({ event }: { event: MasterCalendarEvent }) {
  const kind = channelKindOf(event);
  const Icon = KIND_ICONS[kind];
  const { href, label } = kindHref(kind);
  return (
    <Link
      href={href}
      title={`${event.time ? `${event.time} · ` : ""}${event.title} — manage in ${label}`}
      className="flex items-center gap-1.5 rounded-md bg-white/5 px-1.5 py-1 text-[11px] leading-tight transition hover:translate-x-0.5 hover:bg-white/10"
    >
      <Icon className="h-3 w-3 shrink-0 text-[var(--muted-foreground)]" />
      {event.time ? <span className="shrink-0 font-semibold text-[var(--muted-foreground)]">{event.time}</span> : null}
      <span className="min-w-0 truncate text-white">{event.title}</span>
      {event.recurring ? <Repeat className="h-2.5 w-2.5 shrink-0 text-[var(--muted-foreground)]" /> : null}
    </Link>
  );
}

/** A post as a full row: when, what kind, title, status, and where to edit it. */
function EventRow({ event, accent }: { event: MasterCalendarEvent; accent: string }) {
  const kind = channelKindOf(event);
  const Icon = KIND_ICONS[kind];
  const { href, label } = kindHref(kind);
  return (
    <Link
      href={href}
      title={`Manage in ${label}`}
      className="group flex items-center gap-3 rounded-lg border border-[var(--border)] border-l-2 bg-white/5 px-3 py-2.5 transition hover:border-[var(--border-strong)] hover:bg-white/10"
      style={{ borderLeftColor: accent }}
    >
      <span className="w-12 shrink-0 text-sm font-semibold text-[var(--accent)]">{event.time ?? "—"}</span>
      <Icon className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white">{event.title}</span>
        <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
          {CHANNEL_KIND_LABELS[kind].singular} · {label}
        </span>
      </span>
      {event.recurring ? <Repeat className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" /> : null}
      <Badge className={cn("shrink-0 capitalize", statusTone(event.status))}>{event.status}</Badge>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] opacity-0 transition group-hover:opacity-100" />
    </Link>
  );
}

/** The identity strip: who this network posts as, and whether it can. */
function ChannelIdentity({ channel, data }: { channel: ChannelId; data: ChannelResponse | null }) {
  const meta = CHANNELS[channel];
  const Icon = CHANNEL_ICONS[channel];
  const connected = (data?.connected ?? 0) > 0;
  const held = connected && Boolean(data?.blocker);
  const account = data?.account ?? null;

  return (
    <Card
      className="mb-4 overflow-hidden border-l-2 p-4"
      style={{
        borderLeftColor: meta.color,
        background: `linear-gradient(120deg, color-mix(in srgb, ${meta.color} 12%, transparent), transparent 60%)`
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full"
          style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 18%, transparent)`, color: meta.color }}
        >
          {account?.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote avatar host isn't in next.config images
            <img src={account.thumbnail} alt="" className="h-full w-full object-cover" />
          ) : (
            <Icon className="h-5 w-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-white">{account?.title ?? meta.label}</p>
          <p className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                held ? "bg-amber-400" : connected ? "bg-emerald-400" : "bg-white/20"
              )}
            />
            <span className="truncate">
              {!data
                ? "Checking connection…"
                : held
                  ? data.blocker
                  : connected
                    ? `${account?.handle ? `@${account.handle}` : meta.label} · posting automatically`
                    : `${meta.label} is not connected yet`}
            </span>
          </p>
        </div>
        <Link
          href={meta.manageHref}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition hover:border-[var(--border-strong)] hover:text-white"
        >
          Manage
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </Card>
  );
}

export function ChannelHubPage({ channel }: { channel: ChannelId }) {
  const meta = CHANNELS[channel];
  const todayKey = useMemo(() => localTodayKey(), []);
  const [view, setView] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState(todayKey);
  const [hidden, setHidden] = useState<Set<ChannelKind>>(new Set());
  const [response, setResponse] = useState<ChannelResponse | null>(null);
  const [fetchedRange, setFetchedRange] = useState<string | null>(null);

  // The list view reads a month forward from today; the grids read their grid.
  const range = useMemo(() => {
    if (view === "week") return { start: startOfWeek(anchor), days: 7 };
    if (view === "month") return { start: startOfWeek(`${anchor.slice(0, 8)}01`), days: 42 };
    return { start: todayKey, days: 31 };
  }, [view, anchor, todayKey]);
  const rangeId = `${channel}:${range.start}:${range.days}`;
  const loading = fetchedRange !== rangeId;

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/channels/${channel}?start=${range.start}&days=${range.days}`, {
      cache: "no-store",
      signal: controller.signal
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`${res.status}`))))
      .then((json: ChannelResponse) => {
        setResponse(json);
        setFetchedRange(rangeId);
      })
      .catch((error) => {
        // Settle the range on real errors so the spinner doesn't run forever.
        if (!(error instanceof DOMException && error.name === "AbortError")) setFetchedRange(rangeId);
      });
    return () => controller.abort();
  }, [channel, rangeId, range.start, range.days]);

  const events = useMemo(() => response?.events ?? [], [response]);
  const visibleEvents = useMemo(
    () => events.filter((event) => !hidden.has(channelKindOf(event))),
    [events, hidden]
  );
  const eventsByDay = useMemo(() => {
    const byDay = new Map<string, MasterCalendarEvent[]>();
    for (const event of visibleEvents) {
      if (!byDay.has(event.dateKey)) byDay.set(event.dateKey, []);
      byDay.get(event.dateKey)!.push(event);
    }
    return byDay;
  }, [visibleEvents]);
  const counts = useMemo(() => countByKind(events), [events]);

  const shift = (direction: 1 | -1) => {
    setAnchor((current) => {
      if (view === "week") return addDays(current, 7 * direction);
      const [y, m] = current.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1 + direction, 1)).toISOString().slice(0, 10);
    });
  };

  const toggleKind = (kind: ChannelKind) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const periodLabel = useMemo(() => {
    if (view === "week") {
      const start = startOfWeek(anchor);
      return `${formatKey(start, { month: "short", day: "numeric" })} – ${formatKey(addDays(start, 6), { month: "short", day: "numeric", year: "numeric" })}`;
    }
    if (view === "month") return formatKey(anchor, { month: "long", year: "numeric" });
    return "Next 31 days";
  }, [view, anchor]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [anchor]);

  const monthDays = useMemo(
    () => Array.from({ length: 42 }, (_, i) => addDays(startOfWeek(`${anchor.slice(0, 8)}01`), i)),
    [anchor]
  );

  const listDays = useMemo(
    () => Array.from({ length: 31 }, (_, i) => addDays(todayKey, i)).filter((key) => (eventsByDay.get(key) ?? []).length > 0),
    [todayKey, eventsByDay]
  );

  return (
    <div>
      <PageHeader
        eyebrow="Channel"
        title={meta.label}
        description={`Everything scheduled to go out on ${meta.label} — short clips, long-form videos, carousels and text posts, in one calendar. Each row opens where that post is managed.`}
      />

      <ChannelSwitcher active={channel} />
      <ChannelIdentity channel={channel} data={response} />

      {/* Kind summary: the window's mix, and a filter for each. */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {counts.map(({ kind, count }) => {
          const Icon = KIND_ICONS[kind];
          const isHidden = hidden.has(kind);
          return (
            <button
              key={kind}
              type="button"
              onClick={() => toggleKind(kind)}
              title={isHidden ? `Show ${CHANNEL_KIND_LABELS[kind].plural}` : `Hide ${CHANNEL_KIND_LABELS[kind].plural}`}
              className={cn(
                "flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left transition hover:border-[var(--border-strong)]",
                isHidden && "opacity-45"
              )}
            >
              <span className="rounded-lg bg-white/6 p-2 text-[var(--accent)]">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-2xl font-semibold leading-tight text-white">{count}</span>
                <span className={cn("block truncate text-xs text-[var(--muted-foreground)]", isHidden && "line-through")}>
                  {CHANNEL_KIND_LABELS[kind].plural}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-gradient-to-r from-white/[0.04] to-transparent px-4 py-3">
          <div className="flex items-center gap-2">
            {view === "list" ? null : (
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
            )}
            <span className="ml-1 flex items-center gap-2 text-sm font-semibold tracking-tight text-white">
              <CalendarDays className="h-4 w-4" style={{ color: meta.color }} />
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
            {(["week", "month", "list"] as const).map((mode) => (
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
                      <span
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full text-xs",
                          isToday
                            ? "bg-[var(--accent)] font-semibold text-[var(--accent-contrast)] shadow-[0_0_10px_color-mix(in_srgb,var(--accent)_50%,transparent)]"
                            : "text-[var(--muted-foreground)]"
                        )}
                      >
                        {Number(dateKey.slice(8, 10))}
                      </span>
                      {dayEvents.map((event) => (
                        <EventChip key={event.id} event={event} />
                      ))}
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
                    <div
                      className={cn(
                        "flex items-baseline justify-center gap-1.5 border-b border-[var(--border)] px-2 py-2",
                        isToday && "border-b-2 border-b-[var(--accent)]/60 bg-[var(--accent)]/10"
                      )}
                    >
                      <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                        {WEEKDAY_LABELS[weekdayOf(dateKey)]}
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
                    </div>
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

        {view === "list" ? (
          <div className="panel-enter space-y-4 p-4">
            {listDays.map((dateKey) => (
              <div key={dateKey}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  {dateKey === todayKey ? "Today · " : ""}
                  {formatKey(dateKey, { weekday: "long", month: "short", day: "numeric" })}
                </p>
                <div className="space-y-1.5">
                  {(eventsByDay.get(dateKey) ?? []).map((event) => (
                    <EventRow key={event.id} event={event} accent={meta.color} />
                  ))}
                </div>
              </div>
            ))}
            {listDays.length === 0 && !loading ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <CalendarDays className="h-8 w-8 text-[var(--muted-foreground)]/50" />
                <p className="text-sm text-[var(--muted-foreground)]">Nothing scheduled for {meta.label} in the next month.</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      {!loading && visibleEvents.length === 0 && view !== "list" ? (
        <Card className="mt-4 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">
            Nothing scheduled for {meta.label} in this period. Queue clips in the{" "}
            <Link href="/uploading-center" className="text-[var(--accent)] hover:underline">
              Uploading Center
            </Link>
            , plan carousels in{" "}
            <Link href="/carousels" className="text-[var(--accent)] hover:underline">
              Carousels
            </Link>{" "}
            or generate a{" "}
            <Link href="/x-posts" className="text-[var(--accent)] hover:underline">
              Threads pack
            </Link>
            .
          </p>
        </Card>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted-foreground)]">
        {response ? <span>Times shown in {response.timezone}</span> : null}
        <Link href="/master-calendar" className="inline-flex items-center gap-1 hover:text-white">
          Every channel at once
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

/** The other channels, so the hub is navigable without going back to the rail. */
function ChannelSwitcher({ active }: { active: ChannelId }) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {Object.values(CHANNELS).map((meta) => {
        const Icon = CHANNEL_ICONS[meta.id];
        const isActive = meta.id === active;
        return (
          <Link
            key={meta.id}
            href={`/channels/${meta.id}`}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
              isActive
                ? "border-transparent text-white"
                : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--border-strong)] hover:text-white"
            )}
            style={isActive ? { backgroundColor: `color-mix(in srgb, ${meta.color} 22%, transparent)` } : undefined}
          >
            <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
            {meta.label}
          </Link>
        );
      })}
    </div>
  );
}
