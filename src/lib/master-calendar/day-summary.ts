import {
  CALENDAR_SOURCES,
  type CalendarSource,
  type CalendarSourceId,
  type MasterCalendarEvent
} from "@/lib/master-calendar/types";

/**
 * The Day Summary's model: one day's MasterCalendarEvents rolled up into the
 * numbers an executive read wants first — how much is going out, to which
 * networks, in what state, and when the day starts and ends — plus the same
 * events grouped into the sections the page renders.
 */

/** What a source-native status means once it is only about "is this done". */
export type SummaryState = "published" | "scheduled" | "failed" | "pending";

export type DaySummarySection = {
  source: CalendarSource;
  events: MasterCalendarEvent[];
  states: Record<SummaryState, number>;
};

export type DaySummary = {
  dateKey: string;
  total: number;
  states: Record<SummaryState, number>;
  /** Platform display label → number of pieces landing there that day. */
  platforms: { label: string; count: number }[];
  sections: DaySummarySection[];
  /** Wall-clock HH:mm of the first and last timed piece, if any. */
  firstTime?: string;
  lastTime?: string;
  /** Pieces with no time of day (drafts, tracked content, day-level packs). */
  untimed: number;
};

const PUBLISHED = new Set(["published", "posted", "live", "done", "complete", "completed"]);
const FAILED = new Set(["failed", "error"]);
const SCHEDULED = new Set(["scheduled", "queued", "uploaded", "processing"]);

/**
 * A source-native status as one of four states. Anything the app has not
 * committed to a time yet — a draft FB post, a suggested Threads pack, a
 * tracker stage like "editing" — is pending: real work for the day, but not
 * something the publisher will fire on its own.
 */
export function summaryState(status: string): SummaryState {
  const value = status.toLowerCase();
  if (PUBLISHED.has(value)) return "published";
  if (FAILED.has(value)) return "failed";
  if (SCHEDULED.has(value)) return "scheduled";
  return "pending";
}

function emptyStates(): Record<SummaryState, number> {
  return { published: 0, scheduled: 0, failed: 0, pending: 0 };
}

/** Timed pieces in clock order, then day-level ones — how the day plays out. */
function byTime(a: MasterCalendarEvent, b: MasterCalendarEvent): number {
  if (a.time && b.time) return a.time.localeCompare(b.time);
  if (a.time) return -1;
  if (b.time) return 1;
  return a.title.localeCompare(b.title);
}

export function buildDaySummary(dateKey: string, allEvents: MasterCalendarEvent[]): DaySummary {
  const events = allEvents.filter((event) => event.dateKey === dateKey);
  const states = emptyStates();
  const platformCounts = new Map<string, number>();
  const bySource = new Map<CalendarSourceId, MasterCalendarEvent[]>();

  for (const event of events) {
    states[summaryState(event.status)] += 1;
    for (const platform of new Set(event.platforms)) {
      platformCounts.set(platform, (platformCounts.get(platform) ?? 0) + 1);
    }
    if (!bySource.has(event.source)) bySource.set(event.source, []);
    bySource.get(event.source)!.push(event);
  }

  const times = events.map((event) => event.time).filter((time): time is string => Boolean(time)).sort();

  return {
    dateKey,
    total: events.length,
    states,
    platforms: [...platformCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    sections: CALENDAR_SOURCES.filter((source) => bySource.has(source.id)).map((source) => {
      const sourceEvents = [...bySource.get(source.id)!].sort(byTime);
      const sectionStates = emptyStates();
      for (const event of sourceEvents) sectionStates[summaryState(event.status)] += 1;
      return { source, events: sourceEvents, states: sectionStates };
    }),
    firstTime: times[0],
    lastTime: times[times.length - 1],
    untimed: events.length - times.length
  };
}
