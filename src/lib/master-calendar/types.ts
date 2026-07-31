/**
 * The Master Calendar's unified event model. Every distribution surface —
 * scheduled shorts uploads (publish queue), carousel upload schedules,
 * Threads daily packs, FB/IG thread posts and the dated content tracker —
 * is flattened into MasterCalendarEvent so one calendar can render them all
 * side by side and link back to the calendar that owns each item.
 */

export type CalendarSourceId = "shorts" | "carousels" | "x" | "fb" | "content";

/**
 * What the calendar needs to reschedule an event without a second fetch.
 * Present only on events backed by a system that can actually be rewritten —
 * the publish queue and the Threads autopilot's queue. Carousel schedules,
 * FB/IG drafts and the content tracker are still read-only here and link out.
 */
export type CalendarEditTarget = {
  kind: "queue" | "threads";
  id: string;
  /** Current instant, UTC ISO-8601. */
  publishAt: string;
  /** The editable copy: a queue item's caption, or the Threads post text. */
  text: string;
  /** Set when it can no longer be moved; the sentence says why. */
  lockedReason?: string;
};

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
  edit?: CalendarEditTarget;
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

export type MasterCalendarResponse = {
  timezone: string;
  /** Whether the shorts publisher is configured on (mirrors /api/publish). */
  publishEnabled: boolean;
  /** First day of the returned window, YYYY-MM-DD. */
  start: string;
  days: number;
  events: MasterCalendarEvent[];
};
