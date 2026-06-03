import type { ContentItem, ContentStatus, CreatorProfile } from "@/types/domain";
import type {
  MonetizationReadiness,
  StudioInsights,
  StudioOverview,
  StudioSource,
  StudioVideoRow,
  StudioVisibility
} from "@/lib/youtube/types";

// YouTube Partner Program thresholds (last 12 months of public watch time).
export const MONETIZATION_SUBSCRIBERS = 1000;
export const MONETIZATION_WATCH_HOURS = 4000;

// A video counts as published history if it landed within this window, used to
// estimate the channel's current upload cadence.
const CADENCE_WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

// Performance is judged against the channel's own median views so it scales with
// the channel rather than using absolute view counts.
const TOP_RATIO = 1.5;
const UNDER_RATIO = 0.5;
const MIN_RANKED_VIDEOS = 3;

/**
 * Pulls a YouTube video id out of the common URL shapes (watch, youtu.be, shorts,
 * live, embed). Returns null when the URL is missing or not recognizably a video,
 * which is the signal to fall back to a placeholder thumbnail.
 */
export function parseYouTubeVideoId(url?: string): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = parsed.pathname.slice(1).split("/")[0];
    return id || null;
  }
  if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    const watch = parsed.searchParams.get("v");
    if (watch) return watch;
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length >= 2 && ["shorts", "live", "embed", "v"].includes(segments[0])) {
      return segments[1];
    }
  }
  return null;
}

export function thumbnailForItem(item: ContentItem): string | null {
  const id = parseYouTubeVideoId(item.url);
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
}

export function visibilityForStatus(status: ContentStatus): StudioVisibility {
  if (status === "Published") return "Public";
  if (status === "Scheduled") return "Scheduled";
  return "Draft";
}

function clampPct(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(100, value);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function toRow(item: ContentItem): StudioVideoRow {
  const views = item.views ?? 0;
  const likes = item.likes ?? 0;
  const comments = item.comments ?? 0;
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    visibility: visibilityForStatus(item.status),
    restriction: "None",
    publishDate: item.publishDate,
    views,
    likes,
    comments,
    watchHours: item.watchHours ?? 0,
    revenue: item.revenue ?? 0,
    engagementRate: views > 0 ? (likes + comments) / views : 0,
    thumbnailUrl: thumbnailForItem(item),
    url: item.url || undefined,
    performance: "normal"
  };
}

function isWithinDays(dateString: string | undefined, now: Date, days: number): boolean {
  if (!dateString) return false;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return false;
  return now.getTime() - date.getTime() <= days * DAY_MS && date.getTime() <= now.getTime();
}

function isSameMonth(dateString: string | undefined, now: Date): boolean {
  if (!dateString) return false;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

/**
 * Tags each published row as a top / under performer relative to the channel's
 * median views, and returns the standout lists for the insights panel. Needs a few
 * published videos before it draws any conclusions.
 */
function classifyPerformance(rows: StudioVideoRow[]): StudioInsights {
  const ranked = rows.filter((row) => row.visibility === "Public" && row.views > 0);
  if (ranked.length < MIN_RANKED_VIDEOS) {
    return { medianViews: median(ranked.map((row) => row.views)), topPerformers: [], underPerformers: [] };
  }

  const medianViews = median(ranked.map((row) => row.views));
  const topPerformers: StudioVideoRow[] = [];
  const underPerformers: StudioVideoRow[] = [];

  for (const row of ranked) {
    const ratio = medianViews > 0 ? row.views / medianViews : 1;
    if (ratio >= TOP_RATIO) {
      row.performance = "top";
      row.performanceReason = `${ratio.toFixed(1)}× the channel's median views`;
      topPerformers.push(row);
    } else if (ratio <= UNDER_RATIO) {
      row.performance = "under";
      row.performanceReason = `Only ${Math.round(ratio * 100)}% of the channel's median views`;
      underPerformers.push(row);
    }
  }

  topPerformers.sort((a, b) => b.views - a.views);
  underPerformers.sort((a, b) => a.views - b.views);
  return { medianViews, topPerformers, underPerformers };
}

function buildMonetization(
  profile: CreatorProfile,
  publishedRows: StudioVideoRow[],
  now: Date
): MonetizationReadiness {
  const subscriberTarget = MONETIZATION_SUBSCRIBERS;
  const watchHourTarget = MONETIZATION_WATCH_HOURS;
  const subscribersRemaining = Math.max(0, subscriberTarget - profile.subscribers);
  const watchHoursRemaining = Math.max(0, watchHourTarget - profile.watchHours);
  const subscriberPct = clampPct((profile.subscribers / subscriberTarget) * 100);
  const watchHourPct = clampPct((profile.watchHours / watchHourTarget) * 100);
  const eligible = profile.subscribers >= subscriberTarget && profile.watchHours >= watchHourTarget;

  let bottleneck: MonetizationReadiness["bottleneck"] = "none";
  if (!eligible) {
    bottleneck = subscriberPct <= watchHourPct ? "subscribers" : "watchHours";
  }

  // Estimate cadence + watch-hour velocity from recent uploads. Fall back to the
  // full published span when nothing landed in the recent window.
  const recent = publishedRows.filter((row) => isWithinDays(row.publishDate, now, CADENCE_WINDOW_DAYS));
  const cadencePool = recent.length > 0 ? recent : publishedRows;

  let uploadsPerMonth: number | null = null;
  if (recent.length > 0) {
    uploadsPerMonth = recent.length / (CADENCE_WINDOW_DAYS / 30);
  } else if (publishedRows.length >= 2) {
    const dates = publishedRows
      .map((row) => (row.publishDate ? new Date(row.publishDate).getTime() : NaN))
      .filter((time) => !Number.isNaN(time));
    if (dates.length >= 2) {
      const spanDays = (Math.max(...dates) - Math.min(...dates)) / DAY_MS;
      uploadsPerMonth = spanDays > 0 ? dates.length / (spanDays / 30) : null;
    }
  }

  const watchSamples = cadencePool.filter((row) => row.watchHours > 0).map((row) => row.watchHours);
  const avgWatchHoursPerUpload =
    watchSamples.length > 0 ? watchSamples.reduce((sum, value) => sum + value, 0) / watchSamples.length : null;

  let monthsToWatchHours: number | null = null;
  let projectedWatchHourDate: string | null = null;
  if (!eligible && watchHoursRemaining > 0 && uploadsPerMonth && avgWatchHoursPerUpload) {
    const monthlyWatchHours = uploadsPerMonth * avgWatchHoursPerUpload;
    if (monthlyWatchHours > 0) {
      monthsToWatchHours = watchHoursRemaining / monthlyWatchHours;
      const projected = new Date(now.getTime());
      projected.setMonth(projected.getMonth() + Math.ceil(monthsToWatchHours));
      projectedWatchHourDate = projected.toISOString().slice(0, 10);
    }
  }

  return {
    monetized: profile.monetized,
    eligible,
    subscribers: profile.subscribers,
    subscriberTarget,
    subscriberPct,
    subscribersRemaining,
    watchHours: profile.watchHours,
    watchHourTarget,
    watchHourPct,
    watchHoursRemaining,
    bottleneck,
    uploadsPerMonth,
    avgWatchHoursPerUpload,
    monthsToWatchHours,
    projectedWatchHourDate
  };
}

/**
 * Turns the user's tracked YouTube content + channel profile into a Studio-shaped
 * overview: a sortable content table, monetization readiness, and standout
 * performers. The same shape is what a live YouTube API connection would populate,
 * which keeps the UI source-agnostic.
 */
export function deriveStudioOverview(
  items: ContentItem[],
  profile: CreatorProfile,
  options: { source?: StudioSource; now?: Date } = {}
): StudioOverview {
  const now = options.now ?? new Date();
  const source = options.source ?? "tracked";

  const youtubeItems = items.filter((item) => item.platform === "YouTube");
  const rows = youtubeItems
    .map(toRow)
    .sort((a, b) => {
      const aTime = a.publishDate ? new Date(a.publishDate).getTime() : 0;
      const bTime = b.publishDate ? new Date(b.publishDate).getTime() : 0;
      return bTime - aTime;
    });

  const publishedRows = rows.filter((row) => row.visibility === "Public");
  const insights = classifyPerformance(rows);
  const monetization = buildMonetization(profile, publishedRows, now);

  const revenueThisMonth = publishedRows
    .filter((row) => isSameMonth(row.publishDate, now))
    .reduce((sum, row) => sum + row.revenue, 0);

  return {
    channelName: profile.channelName,
    platform: profile.platform,
    subscribers: profile.subscribers,
    totalViews: profile.totalViews,
    watchHours: profile.watchHours,
    publishedCount: publishedRows.length,
    revenueThisMonth,
    rows,
    monetization,
    insights,
    source
  };
}
