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

type Outcome = "published" | "failed" | "byHand" | "scheduled" | "shouldBeLive" | "overdue" | "needsConnection";

export type WeekLatestPost = {
  title: string;
  dateKey: string;
  /** The post on its own platform, when its URL can be built. */
  url?: string;
  /** The post's card inside the app, on THIS platform's tab where it has one - always there. */
  href: string;
};

export type WeekPlatformRow = {
  id: WeekPlatformId;
  label: string;
  published: number;
  failed: number;
  /** Legs nobody can post for the app: waiting for a hand-post. */
  byHand: number;
  /** Booked or queued and not out yet (a post past its slot is counted below, not here). */
  scheduled: number;
  /** Held by the platform and past its slot: it should be live by now, so it is not "still to go". */
  shouldBeLive: number;
  /** Past its slot and the publisher has not sent it. */
  overdue: number;
  /**
   * On an account with no connection: past its slot it could never go; still
   * ahead of it, it will not go on its own. Counted here and not again in `scheduled`.
   */
  needsConnection: number;
  /**
   * The card to open to fix the newest failed post, when any failed. With
   * several, it is the most recent one: fixing it lands the person where the rest are.
   */
  failedHref?: string;
  /** This platform's own analytics, only where a stable address exists. */
  analytics?: { url: string; label: string };
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

/**
 * This week's YouTube views against the videos posted in the 7 days before it.
 * The app caches each video's lifetime count, not a history, so this compares
 * two groups of videos by what each has earned SO FAR - the earlier group has
 * had longer to earn it. A video with no numbers yet is left out of its group
 * (and said so in `videosCounted` / `videosTotal`); it exists only when both
 * groups have at least one video with numbers.
 */
export type WeekTrend = {
  /** Videos behind the comparison, both weeks together. */
  videosCounted: number;
  /** Videos in both weeks, including those with no numbers yet. */
  videosTotal: number;
  previousViews: number;
  previousVideos: number;
  /** views this week minus views for the previous 7 days. */
  change: number;
  /** Whole percent against the previous 7 days. */
  percent: number;
};

export type WeekSummary = {
  startKey: string;
  endKey: string;
  rows: WeekPlatformRow[];
  totals: { published: number; failed: number; byHand: number; scheduled: number; shouldBeLive: number; overdue: number; needsConnection: number };
  youtube: {
    /** Videos with numbers behind the totals. */
    videos: number;
    /** Tracked videos this week with nothing cached yet. */
    missing: number;
    /**
     * Published YouTube posts that are not tracked at all, so no numbers can ever
     * be asked for: a long-form upload still held private for review, or a leg
     * that never recorded a usable video id.
     */
    untracked: { heldForReview: number; noVideoId: number };
    views: number;
    likes: number;
    /** The newest reading behind the totals; null when there are none. */
    fetchedAt: string | null;
  };
  top: WeekTopPost | null;
  /** Null when either group has no video with numbers, or the earlier group has no views to compare with. */
  trend: WeekTrend | null;
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

type Leg = { platform: WeekPlatformId; outcome: Outcome; url?: string; href?: string };

/**
 * Where a platform's own analytics live, for the platforms that have one address
 * that does not depend on an id this app does not hold. YouTube's is per video
 * (see `studioAnalyticsUrl`). Instagram and Facebook share Meta Business Suite.
 * Threads insights exist only inside the app, so there is no link to give.
 */
export const PLATFORM_ANALYTICS: Partial<Record<WeekPlatformId, { url: string; label: string }>> = {
  instagram: { url: "https://business.facebook.com/latest/insights", label: "Analytics in Meta Business Suite" },
  facebook: { url: "https://business.facebook.com/latest/insights", label: "Analytics in Meta Business Suite" },
  tiktok: { url: "https://www.tiktok.com/tiktokstudio/analytics", label: "Analytics in TikTok Studio" }
};

/** What one calendar event did on each platform it targets. */
function legsOf(event: MasterCalendarEvent): Leg[] {
  // A repeating carousel schedule is a standing prompt with no "done" state, so
  // it can neither be late nor complete; counting it would only add noise.
  if (isReminderEventStatus(event.status)) return [];
  const out: Leg[] = [];
  if (event.legs) {
    for (const leg of event.legs) {
      const platform = platformIdOf(leg.platform);
      // A leg past its slot is its own outcome, not one more "still to go".
      const outcome: Outcome | undefined =
        leg.late === "should-be-live"
          ? "shouldBeLive"
          : leg.late === "overdue"
            ? "overdue"
            : leg.late === "needs-connection"
              ? "needsConnection"
              : leg.awaitingConnection
                ? "needsConnection"
                : LEG_OUTCOMES[leg.status];
      if (platform && outcome) {
        out.push({ platform, outcome, ...(leg.url ? { url: leg.url } : {}), ...(leg.href ? { href: leg.href } : {}) });
      }
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
    else if (state === "shouldBeLive") outcome = "shouldBeLive";
    else if (state === "overdue") outcome = "overdue";
    else if (state === "needsConnection") outcome = "needsConnection";
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
    shouldBeLive: 0,
    overdue: 0,
    needsConnection: 0,
    numbersNote: numbersNote(platform.label, platform.id)
  }));
  const rowOf = new Map(rows.map((row) => [row.id, row]));
  const latestAt = new Map<WeekPlatformId, MasterCalendarEvent>();
  const latestFailed = new Map<WeekPlatformId, MasterCalendarEvent>();

  for (const event of events) {
    for (const leg of legsOf(event)) {
      const row = rowOf.get(leg.platform)!;
      row[leg.outcome] += 1;
      if (leg.outcome === "failed") {
        const worst = latestFailed.get(leg.platform);
        if (!worst || laterThan(event, worst)) {
          latestFailed.set(leg.platform, event);
          const failure = event.failures?.find((entry) => platformIdOf(entry.platform) === leg.platform);
          row.failedHref = leg.href ?? failure?.href ?? eventHref(event);
        }
        continue;
      }
      if (leg.outcome !== "published") continue;
      const best = latestAt.get(leg.platform);
      if (best && !laterThan(event, best)) continue;
      latestAt.set(leg.platform, event);
      row.latest = {
        title: event.title,
        dateKey: event.dateKey,
        // The leg's own card when it has one: the event's href points at whichever
        // platform needs a look, which is not this row's platform.
        href: leg.href ?? eventHref(event),
        ...(leg.url ? { url: leg.url } : {})
      };
    }
  }

  const totals = { published: 0, failed: 0, byHand: 0, scheduled: 0, shouldBeLive: 0, overdue: 0, needsConnection: 0 };
  for (const row of rows) {
    totals.published += row.published;
    totals.failed += row.failed;
    totals.byHand += row.byHand;
    totals.scheduled += row.scheduled;
    totals.shouldBeLive += row.shouldBeLive;
    totals.overdue += row.overdue;
    totals.needsConnection += row.needsConnection;
  }

  const youtubeTargets = events.flatMap((event) => (event.youtube ? [event.youtube] : []));
  const videoIds = youtubeTargets.map((target) => target.videoId);
  const { views, likes, videos } = totalViews(stats, videoIds);
  const uniqueIds = new Set(videoIds);
  const untracked = { heldForReview: 0, noVideoId: 0 };
  for (const event of events) {
    if (event.youtube) continue;
    const published = legsOf(event).some((leg) => leg.platform === "youtube" && leg.outcome === "published");
    if (!published) continue;
    if (event.heldForReview) untracked.heldForReview += 1;
    else untracked.noVideoId += 1;
  }

  const trend = weekTrend({
    current: { videos, views, tracked: uniqueIds.size },
    previousIds: options.events
      .filter((event) => event.dateKey >= shiftDayKey(startKey, -days) && event.dateKey < startKey)
      .flatMap((event) => (event.youtube ? [event.youtube.videoId] : [])),
    stats
  });

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

  for (const row of rows) {
    const fixed = PLATFORM_ANALYTICS[row.id];
    if (fixed) row.analytics = fixed;
  }
  // YouTube's page is per video: the week's best, else the newest one that went out.
  const youtubeRow = rowOf.get("youtube")!;
  const newestYoutube = [...events]
    .filter((event) => event.youtube)
    .sort((a, b) => (laterThan(a, b) ? -1 : 1))[0];
  const studioVideoId = top?.videoId ?? newestYoutube?.youtube?.videoId;
  if (studioVideoId) youtubeRow.analytics = { url: studioAnalyticsUrl(studioVideoId), label: "Analytics in YouTube Studio" };

  return {
    startKey,
    endKey,
    rows,
    totals,
    youtube: {
      videos,
      missing: [...uniqueIds].filter((id) => !stats[id] || stats[id].views === null).length,
      untracked,
      views,
      likes,
      fetchedAt: newestFetchedAt(stats, [...uniqueIds])
    },
    top,
    trend,
    youtubeTargets
  };
}

/**
 * The comparison with the 7 days before, or null when it would be a guess.
 * Videos with no numbers yet are left out of their side rather than blocking
 * the whole comparison; `videosCounted` of `videosTotal` says how many it used.
 */
export function weekTrend(options: {
  current: { videos: number; views: number; tracked: number };
  previousIds: string[];
  stats: Record<string, YoutubeStat>;
}): WeekTrend | null {
  const { current, previousIds, stats } = options;
  if (current.videos === 0) return null;
  const unique = [...new Set(previousIds)];
  const previous = totalViews(stats, unique);
  if (previous.videos === 0 || previous.views <= 0) return null;
  const change = current.views - previous.views;
  return {
    videosCounted: current.videos + previous.videos,
    videosTotal: current.tracked + unique.length,
    previousViews: previous.views,
    previousVideos: previous.videos,
    change,
    percent: Math.round((change / previous.views) * 100)
  };
}

/** "based on 5 of 6 videos" when some had no numbers to use; null when every video was counted. */
export function trendBasisNote(trend: Pick<WeekTrend, "videosCounted" | "videosTotal">): string | null {
  if (trend.videosCounted >= trend.videosTotal) return null;
  return `based on ${trend.videosCounted} of ${trend.videosTotal} videos`;
}

/**
 * "1 video has no numbers yet (long-form held private for review)": the videos
 * the totals leave out, and why. Null when every published video is counted.
 * `connected: false` is YouTube's own "cannot be read" answer, which is the
 * reason a tracked video has nothing cached.
 */
export function youtubeNoNumbersNote(youtube: WeekSummary["youtube"], connected = true): string | null {
  const reasons: { count: number; one: string; many: string }[] = [
    {
      count: youtube.untracked.heldForReview,
      one: "long-form held private for review",
      many: "held private for review"
    },
    { count: youtube.untracked.noVideoId, one: "no video id on record", many: "with no video id on record" },
    {
      count: youtube.missing,
      one: connected ? "not read from YouTube yet" : "YouTube is not connected",
      many: connected ? "not read from YouTube yet" : "YouTube is not connected"
    }
  ].filter((reason) => reason.count > 0);
  const total = reasons.reduce((sum, reason) => sum + reason.count, 0);
  if (total === 0) return null;
  const detail = total === 1 ? reasons[0].one : reasons.map((reason) => `${reason.count} ${reason.many}`).join(", ");
  return `${total} ${total === 1 ? "video has" : "videos have"} no numbers yet (${detail})`;
}

/**
 * What the "latest post" link says when it stays inside the app: the screen it
 * opens, named. An external-link icon and "Open latest post" promised the
 * platform itself, and Instagram and Threads rows lead into the app.
 */
export function latestPostLinkLabel(href: string): string {
  if (href.startsWith("/x-posts")) return "Open in Threads Autopilot";
  if (href.startsWith("/uploading-center")) return "Open in Uploading Center";
  if (href.startsWith("/carousels")) return "Open in Carousels";
  if (href.startsWith("/facebook")) return "Open in FB / IG Post Library";
  return "Open in the app";
}
