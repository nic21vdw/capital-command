/**
 * The Master Calendar's unified event model. Every distribution surface —
 * scheduled shorts uploads (publish queue), carousel upload schedules,
 * Threads daily packs, FB/IG thread posts and the dated content tracker —
 * is flattened into MasterCalendarEvent so one calendar can render them all
 * side by side and link back to the calendar that owns each item.
 */

export type CalendarSourceId = "shorts" | "carousels" | "queued-carousels" | "x" | "fb" | "content";

export type MasterCalendarEvent = {
  /** Unique across the whole calendar (source-prefixed). */
  id: string;
  source: CalendarSourceId;
  /** Local calendar date, YYYY-MM-DD (publish timezone for queue items). */
  dateKey: string;
  /** Local wall-clock HH:mm; absent for day-level items (FB/IG, content). */
  time?: string;
  title: string;
  /** Display labels of the networks this event targets. */
  platforms: string[];
  /**
   * Source-native status, lowercased: published/scheduled/queued/failed for
   * shorts, draft/posted for FB/IG, suggested for X packs, the content
   * tracker's pipeline stages, and "scheduled" for carousel occurrences.
   */
  status: string;
  /** True for occurrences expanded from a repeating carousel schedule. */
  recurring?: boolean;
  /** Deep link into the screen that owns this item. Falls back to the source href. */
  href?: string;
};

export type CalendarSource = {
  id: CalendarSourceId;
  /** Full name for legends and empty states. */
  label: string;
  /** Compact name for filter chips and event rows. */
  shortLabel: string;
  /** Dot/accent colour used everywhere this source appears. */
  color: string;
  /** The calendar page that owns these events. */
  href: string;
  hrefLabel: string;
};

export const CALENDAR_SOURCES: CalendarSource[] = [
  {
    id: "shorts",
    label: "Scheduled shorts uploads",
    shortLabel: "Shorts",
    color: "#a855f7",
    href: "/uploading-center",
    hrefLabel: "Uploading Center"
  },
  {
    id: "carousels",
    label: "Carousel upload schedules",
    shortLabel: "Carousels",
    color: "#e1306c",
    href: "/carousels",
    hrefLabel: "Carousels"
  },
  {
    id: "queued-carousels",
    label: "Scheduled carousel posts",
    shortLabel: "Carousel posts",
    color: "#e1306c",
    href: "/carousels",
    hrefLabel: "Carousels"
  },
  {
    id: "x",
    label: "Threads daily packs",
    shortLabel: "Threads",
    color: "#38bdf8",
    href: "/x-posts",
    hrefLabel: "Threads Posts"
  },
  {
    id: "fb",
    label: "FB / IG thread posts",
    shortLabel: "FB / IG",
    color: "#1877f2",
    href: "/facebook",
    hrefLabel: "FB / IG Threads"
  },
  {
    id: "content",
    label: "Long-form & tracked content",
    shortLabel: "Long-form",
    color: "#f59e0b",
    href: "/distribution",
    hrefLabel: "Distribution Centre"
  }
];

export const CALENDAR_SOURCE_BY_ID: Record<CalendarSourceId, CalendarSource> = Object.fromEntries(
  CALENDAR_SOURCES.map((source) => [source.id, source])
) as Record<CalendarSourceId, CalendarSource>;

export function eventHref(event: Pick<MasterCalendarEvent, "source" | "href">): string {
  return event.href || CALENDAR_SOURCE_BY_ID[event.source].href;
}

export type MasterCalendarResponse = {
  timezone: string;
  /** Whether the shorts publisher is configured on (mirrors /api/publish). */
  publishEnabled: boolean;
  /** First day of the returned window, YYYY-MM-DD. */
  start: string;
  days: number;
  events: MasterCalendarEvent[];
};
