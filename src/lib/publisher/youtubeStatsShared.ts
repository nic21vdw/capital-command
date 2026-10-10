/**
 * What the YouTube numbers look like, and the arithmetic around them. Pure and
 * client-safe (no fs, no fetch): the route, the cache and both screens that
 * show the numbers import from here.
 *
 * Only YouTube is read. Instagram, Facebook, TikTok and Threads would each
 * need another permission and another review, so those posts stay status-only
 * and link out to the platform's own numbers.
 */

export type YoutubeStat = {
  /** A count YouTube hides (likes switched off) is null, never a made-up zero. */
  views: number | null;
  likes: number | null;
  comments: number | null;
  /** When these numbers were last read from YouTube, UTC ISO-8601. */
  fetchedAt: string;
};

export type YoutubeStatsStatus = "ok" | "not-connected" | "stale" | "error";

export type YoutubeStatsResponse = {
  /**
   * ok: every number is fresh enough. not-connected: YouTube cannot be read
   * (no sign-in, or the grant lacks read access), so whatever is cached is
   * shown with its age. stale: a refresh failed; the last numbers are shown.
   * error: a refresh failed and there is nothing to show.
   */
  status: YoutubeStatsStatus;
  /** Plain words for the person. Null when everything is fine. */
  message: string | null;
  stats: Record<string, YoutubeStat>;
  /** Queue item id -> YouTube video id, for requests made by item. */
  items: Record<string, string>;
};

/** A video's numbers are re-read at most this often. */
export const STATS_TTL_MS = 30 * 60 * 1000;

/** YouTube's videos.list takes up to 50 ids per call. */
export const STATS_BATCH_SIZE = 50;

export function isVideoId(value: string): boolean {
  return /^[\w-]{6,20}$/.test(value);
}

/** 999 -> "999", 1234 -> "1.2K", 12345 -> "12K", 1500000 -> "1.5M". */
export function compactCount(value: number): string {
  const n = Math.max(0, Math.round(value));
  if (n < 1000) return String(n);
  const trim = (x: number) => (x >= 10 ? String(Math.round(x)) : String(Math.round(x * 10) / 10));
  if (n < 1_000_000) {
    const k = n / 1000;
    // 999,6xx would round to "1000K"; say 1M instead.
    return k >= 999.5 ? "1M" : `${trim(k)}K`;
  }
  return `${trim(n / 1_000_000)}M`;
}

function part(value: number | null, singular: string, plural: string): string | null {
  if (value === null) return null;
  return `${compactCount(value)} ${value === 1 ? singular : plural}`;
}

/** "1.2K views · 45 likes · 3 comments"; counts YouTube hides are left out. */
export function statsLine(stat: Pick<YoutubeStat, "views" | "likes" | "comments">): string {
  return [part(stat.views, "view", "views"), part(stat.likes, "like", "likes"), part(stat.comments, "comment", "comments")]
    .filter((text): text is string => text !== null)
    .join(" · ");
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function agoLabel(fetchedAt: string, now: Date): string {
  const then = new Date(fetchedAt).getTime();
  if (Number.isNaN(then)) return "a while ago";
  const minutes = Math.max(0, Math.floor((now.getTime() - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/** The video's analytics tab in YouTube Studio. */
export function studioAnalyticsUrl(videoId: string): string {
  return `https://studio.youtube.com/video/${encodeURIComponent(videoId)}/analytics/tab-overview/period-default`;
}

/** Total views over the videos that have a number; videos without one are not counted as zero. */
export function totalViews(
  stats: Record<string, YoutubeStat>,
  videoIds: string[]
): { views: number; likes: number; videos: number } {
  let views = 0;
  let likes = 0;
  let videos = 0;
  for (const id of new Set(videoIds)) {
    const stat = stats[id];
    if (!stat || stat.views === null) continue;
    views += stat.views;
    likes += stat.likes ?? 0;
    videos += 1;
  }
  return { views, likes, videos };
}
