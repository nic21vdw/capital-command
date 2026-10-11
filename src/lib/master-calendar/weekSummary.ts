import { shiftDayKey } from "@/lib/master-calendar/day-keys";
import { eventHref, isReminderEventStatus, type MasterCalendarEvent } from "@/lib/master-calendar/types";
import { summaryState } from "@/lib/master-calendar/day-summary";
import {
  newestFetchedAt,
  studioAnalyticsUrl,
  totalViews,
  type YoutubeStat
} from "@/lib/publisher/youtubeStatsShared";

/**
 * "Last 7 days": every platform's week from the events the calendar already
 * has, plus the YouTube numbers the app has cached. Pure.
 *
 * Only YouTube reports views to this app. Instagram, Facebook, TikTok and
 * Threads would each need another permission and review, so their rows say what
 * happened to each post (published, failed, waiting for a hand-post) and where
 * to read the numbers: on the platform, one click from the post. Nothing here
 * invents a number for them.
 *
 * Counted per platform: one video that went to three networks is three posts,
 * because that is the unit that succeeds or fails.
 */

export const WEEK_DAYS = 7;

export type WeekPlatformId = "youtube" | "instagram" | "facebook" | "tiktok" | "threads";

export const WEEK_PLATFORMS: { id: WeekPlatformId; label: string }[] = [
  { id: "youtube", label: "YouTube" },
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "tiktok", label: "TikTok" },
  { id: "threads", label: "Threads" }
];

type Outcome = "published" | "failed" | "byHand" | "scheduled";

export type WeekLatestPost = {
  title: string;
  dateKey: string;
  /** The post on its own platform, when its URL can be built. */
  url?: string;
  /** The post's card inside the app - always there. */
  href: string;
};

export type WeekPlatformRow = {
  id: WeekPlatformId;
  label: string;
  published: number;
  failed: number;
  /** Legs nobody can post for the app: waiting for a hand-post. */
  byHand: number;
  /** Booked or queued and not out yet. */
  scheduled: number;
  /** Where this platform's numbers live. */
  numbersNote: string;
  /** The most recent published post, for a one-click way to its numbers. */
  latest?: WeekLatestPost;
};

export type WeekTopPost = {
  itemId: string;
  videoId: string;
  title: string;
  dateKey: string;
  views: number;
  likes: number | null;
  comments: number | null;
  watchUrl: string;
  studioUrl: string;
  href: string;
};

export type WeekSummary = {
  startKey: string;
  endKey: string;
  rows: WeekPlatformRow[];
  totals: { published: number; failed: number; byHand: number; scheduled: number };
  youtube: {
    /** Videos with numbers behind the totals. */
    videos: number;
    /** Published videos this week with nothing cached yet. */
    missing: number;
    views: number;
    likes: number;
    /** The newest reading behind the totals; null when there are none. */
    fetchedAt: string | null;
  };
  top: WeekTopPost | null;
  /** The published YouTube videos of the week, for the stats request. */
  youtubeTargets: { itemId: string; videoId: string }[];
};

function platformIdOf(label: string): WeekPlatformId | null {
  const value = label.trim().toLowerCase();
  return WEEK_PLATFORMS.find((platform) => platform.id === value)?.id ?? null;
}

const LEG_OUTCOMES: Record<string, Outcome> = {
  published: "published",
  failed: "failed",
  manual: "byHand",
  scheduled: "scheduled",
  uploaded: "scheduled",
  pending: "scheduled"
};

type Leg = { platform: WeekPlatformId; outcome: Outcome; url?: string };

/** What one calendar event did on each platform it targets. */
function legsOf(event: MasterCalendarEvent): Leg[] {
  // A repeating carousel schedule is a standing prompt with no "done" state, so
  // it can neither be late nor complete; counting it would only add noise.
  if (isReminderEventStatus(event.status)) return [];
  const out: Leg[] = [];
  if (event.legs) {
    for (const leg of event.legs) {
      const platform = platformIdOf(leg.platform);
      const outcome = LEG_OUTCOMES[leg.status];
      if (platform && outcome) out.push({ platform, outcome, ...(leg.url ? { url: leg.url } : {}) });
    }
    return out;
  }
  const failedLabels = new Set((event.failedPlatforms ?? []).map((label) => label.toLowerCase()));
  const state = summaryState(event.status);
  const seen = new Set<WeekPlatformId>();
  for (const label of event.platforms) {
    const platform = platformIdOf(label);
    if (!platform || seen.has(platform)) continue;
    seen.add(platform);
    let outcome: Outcome | null = null;
    if (failedLabels.has(label.toLowerCase()) || state === "failed") outcome = "failed";
    else if (state === "published") outcome = "published";
    else if (event.source === "fb" && event.status === "draft") outcome = "byHand";
    else if (state === "scheduled") outcome = "scheduled";
    const url = event.liveLinks?.find((link) => platformIdOf(link.platform) === platform)?.url;
    if (outcome) out.push({ platform, outcome, ...(url ? { url } : {}) });
  }
  return out;
}

function numbersNote(label: string, id: WeekPlatformId): string {
  return id === "youtube" ? "Views and likes are read from YouTube" : `Views on ${label} - open the post`;
}

function laterThan(a: { dateKey: string; time?: string }, b: { dateKey: string; time?: string }): boolean {
  if (a.dateKey !== b.dateKey) return a.dateKey > b.dateKey;
  return (a.time ?? "") > (b.time ?? "");
}

export function buildWeekSummary(options: {
  events: MasterCalendarEvent[];
  /** Last day of the window (normally today). */
  endKey: string;
  days?: number;
  stats?: Record<string, YoutubeStat>;
}): WeekSummary {
  const days = options.days ?? WEEK_DAYS;
  const endKey = options.endKey;
  const startKey = shiftDayKey(endKey, -(days - 1));
  const stats = options.stats ?? {};
  const events = options.events.filter((event) => event.dateKey >= startKey && event.dateKey <= endKey);

  const rows: WeekPlatformRow[] = WEEK_PLATFORMS.map((platform) => ({
    ...platform,
    published: 0,
    failed: 0,
    byHand: 0,
    scheduled: 0,
    numbersNote: numbersNote(platform.label, platform.id)
  }));
  const rowOf = new Map(rows.map((row) => [row.id, row]));
  const latestAt = new Map<WeekPlatformId, MasterCalendarEvent>();

  for (const event of events) {
    for (const leg of legsOf(event)) {
      const row = rowOf.get(leg.platform)!;
      row[leg.outcome] += 1;
      if (leg.outcome !== "published") continue;
      const best = latestAt.get(leg.platform);
      if (best && !laterThan(event, best)) continue;
      latestAt.set(leg.platform, event);
      row.latest = {
        title: event.title,
        dateKey: event.dateKey,
        href: eventHref(event),
        ...(leg.url ? { url: leg.url } : {})
      };
    }
  }

  const totals = { published: 0, failed: 0, byHand: 0, scheduled: 0 };
  for (const row of rows) {
    totals.published += row.published;
    totals.failed += row.failed;
    totals.byHand += row.byHand;
    totals.scheduled += row.scheduled;
  }

  const youtubeTargets = events.flatMap((event) => (event.youtube ? [event.youtube] : []));
  const videoIds = youtubeTargets.map((target) => target.videoId);
  const { views, likes, videos } = totalViews(stats, videoIds);
  const uniqueIds = new Set(videoIds);

  let top: WeekTopPost | null = null;
  for (const event of events) {
    if (!event.youtube) continue;
    const stat = stats[event.youtube.videoId];
    if (!stat || stat.views === null) continue;
    const better =
      !top ||
      stat.views > top.views ||
      (stat.views === top.views && (stat.likes ?? 0) > (top.likes ?? 0));
    if (!better) continue;
    top = {
      itemId: event.youtube.itemId,
      videoId: event.youtube.videoId,
      title: event.title,
      dateKey: event.dateKey,
      views: stat.views,
      likes: stat.likes,
      comments: stat.comments,
      watchUrl:
        event.liveLinks?.find((link) => platformIdOf(link.platform) === "youtube")?.url ??
        `https://www.youtube.com/watch?v=${encodeURIComponent(event.youtube.videoId)}`,
      studioUrl: studioAnalyticsUrl(event.youtube.videoId),
      href: eventHref(event)
    };
  }

  return {
    startKey,
    endKey,
    rows,
    totals,
    youtube: {
      videos,
      missing: [...uniqueIds].filter((id) => !stats[id] || stats[id].views === null).length,
      views,
      likes,
      fetchedAt: newestFetchedAt(stats, [...uniqueIds])
    },
    top,
    youtubeTargets
  };
}
