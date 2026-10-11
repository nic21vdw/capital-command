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

/**
 * A person pressing Refresh skips the 30-minute wait but not all of it: a video
 * read less than this long ago is not read again, so mashing the button costs
 * no more quota than pressing it once.
 */
export const STATS_REFRESH_MIN_MS = 60 * 1000;

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

/**
 * How old a set of numbers is, worded for what the person can do about it.
 * "Updated 12 min ago" only when they were read recently; otherwise "Numbers
 * from 2 days ago", with the reason they were not refreshed - not connected
 * (the one thing the person can fix) or a read that failed just now.
 */
export function statsAgeText(status: YoutubeStatsStatus | "loading", fetchedAt: string, now: Date): string {
  const { text, connect } = statsAgeParts(status, fetchedAt, now);
  return connect ? `${text} - ${CONNECT_TO_REFRESH}` : text;
}

/** The action half of "Numbers from 2 days ago - connect YouTube to refresh". */
export const CONNECT_TO_REFRESH = "connect YouTube to refresh";

/** statsAgeText in two parts, so a screen can turn the "connect YouTube" half into a link. */
export function statsAgeParts(
  status: YoutubeStatsStatus | "loading",
  fetchedAt: string,
  now: Date
): { text: string; connect: boolean } {
  const age = agoLabel(fetchedAt, now);
  const ageMs = now.getTime() - new Date(fetchedAt).getTime();
  // The server re-reads at most every 30 minutes, so anything younger than
  // that (plus a little slack) is as fresh as the numbers get.
  const recent = Number.isFinite(ageMs) && ageMs < STATS_TTL_MS + 5 * 60_000;
  if ((status === "ok" || status === "loading") && recent) return { text: `Updated ${age}`, connect: false };
  if (status === "not-connected") return { text: `Numbers from ${age}`, connect: true };
  if (status === "stale" || status === "error") {
    return { text: `Numbers from ${age} - YouTube could not be reached to refresh`, connect: false };
  }
  return { text: `Numbers from ${age}`, connect: false };
}

/** The newest `fetchedAt` among these videos' numbers, or null when none have any. */
export function newestFetchedAt(stats: Record<string, YoutubeStat>, videoIds: string[]): string | null {
  let newest: string | null = null;
  for (const id of new Set(videoIds)) {
    const at = stats[id]?.fetchedAt;
    if (at && (newest === null || at > newest)) newest = at;
  }
  return newest;
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

/**
 * What to say right after the person pressed Refresh, in words about the
 * numbers on screen. A refresh that could not reach YouTube is not an error
 * to dwell on: the cached numbers are still shown, so it says that.
 */
export function refreshOutcome(status: YoutubeStatsStatus | "loading"): { ok: boolean; text: string } {
  switch (status) {
    case "ok":
      return { ok: true, text: "Checked YouTube just now." };
    case "loading":
      // Nothing on the page has ever asked YouTube about a video, so there was nothing to refresh.
      return { ok: false, text: "There are no YouTube videos on this page to refresh." };
    case "not-connected":
      return { ok: false, text: "YouTube is not connected, so these are the last saved numbers." };
    default:
      return { ok: false, text: "YouTube could not be reached, so these are the last saved numbers." };
  }
}

/** "+23%", "-8%", "0%" - the sign is always spelled out so a rise and a fall are not told apart by colour alone. */
export function percentChangeLabel(percent: number): string {
  if (percent > 0) return `+${percent}%`;
  if (percent < 0) return `-${Math.abs(percent)}%`;
  return "0%";
}
