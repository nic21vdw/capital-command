import { dateTimeFormat } from "@/lib/publisher/intl";
import { localCalendarParts } from "@/lib/publisher/time";
import { ALL_PLATFORMS, type PlatformId, type PlatformStatus, type QueueItem } from "@/lib/publisher/types";

/**
 * One calendar day of the publish queue, rolled up across every platform.
 *
 * The Uploading Center's agenda answers "what does YouTube look like this
 * month?" — one platform per tab, weeks of days. That is the wrong shape for
 * the question asked the night before: "what actually goes out tomorrow, and
 * is any of it going to fail?". A post whose YouTube leg died on a dead token
 * still renders as a healthy card on the Instagram tab, so a whole platform
 * can be down for days without the board ever looking wrong.
 *
 * This rolls one day up the other way: every post on it, every platform each
 * post targets, and the distinct reasons anything on that day cannot post.
 */

/** Statuses that still expect the runner to do something. */
const IN_FLIGHT: PlatformStatus[] = ["pending", "uploaded", "scheduled"];

export type DayPostPlatform = {
  platform: PlatformId;
  status: PlatformStatus;
  error?: string;
};

export type DayPost = {
  id: string;
  title: string;
  /** Local wall-clock time, HH:MM. */
  time: string;
  mediaKind: "video" | "image";
  /** Pictures in an image post's deck; 0 for video. */
  slideCount: number;
  platforms: DayPostPlatform[];
};

export type PlatformRollup = {
  platform: PlatformId;
  /** Posts that day targeting this platform. */
  total: number;
  published: number;
  inFlight: number;
  failed: number;
  manual: number;
  /** Distinct failure reasons, most common first. */
  reasons: string[];
};

export type DaySummary = {
  dateKey: string;
  dateLabel: string;
  timeZone: string;
  posts: DayPost[];
  platforms: PlatformRollup[];
  totals: {
    posts: number;
    videos: number;
    images: number;
    /** Platform legs that have permanently failed. */
    failedLegs: number;
  };
};

/** Local calendar date, YYYY-MM-DD, `days` after the given instant. */
export function dateKeyOffset(now: Date, timeZone: string, days: number): string {
  const { dateKey } = localCalendarParts(now, timeZone);
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function labelForDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return dateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function summarizeDay(
  items: QueueItem[],
  options: { dateKey: string; timeZone: string }
): DaySummary {
  const { dateKey, timeZone } = options;

  const posts: DayPost[] = [];
  for (const item of items) {
    const parts = localCalendarParts(item.publishAt, timeZone);
    if (parts.dateKey !== dateKey) continue;
    const platforms = ALL_PLATFORMS.flatMap<DayPostPlatform>((platform) => {
      const state = item.platforms?.[platform];
      if (!state) return [];
      return [{ platform, status: state.status, ...(state.error ? { error: state.error } : {}) }];
    });
    posts.push({
      id: item.id,
      title: item.title,
      time: parts.time,
      mediaKind: item.mediaKind === "image" ? "image" : "video",
      slideCount: item.imagePaths?.length ?? 0,
      platforms
    });
  }
  posts.sort((a, b) => (a.time === b.time ? a.id.localeCompare(b.id) : a.time.localeCompare(b.time)));

  const platforms = ALL_PLATFORMS.map<PlatformRollup>((platform) => {
    const legs = posts.flatMap((post) => post.platforms.filter((leg) => leg.platform === platform));
    const reasonCounts = new Map<string, number>();
    for (const leg of legs) {
      if (leg.status !== "failed" || !leg.error) continue;
      reasonCounts.set(leg.error, (reasonCounts.get(leg.error) ?? 0) + 1);
    }
    return {
      platform,
      total: legs.length,
      published: legs.filter((leg) => leg.status === "published").length,
      inFlight: legs.filter((leg) => IN_FLIGHT.includes(leg.status)).length,
      failed: legs.filter((leg) => leg.status === "failed").length,
      manual: legs.filter((leg) => leg.status === "manual").length,
      reasons: [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).map(([reason]) => reason)
    };
  }).filter((rollup) => rollup.total > 0);

  return {
    dateKey,
    dateLabel: labelForDateKey(dateKey),
    timeZone,
    posts,
    platforms,
    totals: {
      posts: posts.length,
      videos: posts.filter((post) => post.mediaKind === "video").length,
      images: posts.filter((post) => post.mediaKind === "image").length,
      failedLegs: posts.reduce(
        (sum, post) => sum + post.platforms.filter((leg) => leg.status === "failed").length,
        0
      )
    }
  };
}
