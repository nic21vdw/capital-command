import { classifyFailure, requestJson, type HttpDeps } from "@/lib/analytics/http";
import { dayKey } from "@/lib/analytics/metrics";
import { addNote, newOutcome, stopFromError, type FetchOutcome } from "@/lib/analytics/outcome";
import type { MetricValues } from "@/lib/analytics/types";
import { chunk, parseStatistics } from "@/lib/publisher/youtubeStats";
import { STATS_BATCH_SIZE } from "@/lib/publisher/youtubeStatsShared";

export const YOUTUBE_BATCH_SIZE = STATS_BATCH_SIZE;

const DATA_API = "https://www.googleapis.com/youtube/v3/videos";
const ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2/reports";
const EARLIEST_START = "2005-04-23";

export const YOUTUBE_ANALYTICS_NOTE =
  "Watch time and average view duration need the yt-analytics.readonly permission; until YouTube is reconnected with it, views, likes and comments come from the Data API.";

export type YoutubeVideo = { id: string; publishedAt: string };

export type YoutubeOutcome = FetchOutcome & { analytics: "used" | "unavailable" | "skipped" };

function present(value: number | null): value is number {
  return typeof value === "number";
}

export function parseVideoStatistics(body: unknown): Map<string, MetricValues> {
  const out = new Map<string, MetricValues>();
  const items = (body as { items?: Array<{ id?: unknown; statistics?: Record<string, unknown> }> } | null)?.items;
  if (!Array.isArray(items)) return out;
  for (const item of items) {
    if (typeof item?.id !== "string") continue;
    const stats = parseStatistics(item);
    const metrics: MetricValues = {};
    if (present(stats.views)) metrics.views = stats.views;
    if (present(stats.likes)) metrics.likes = stats.likes;
    if (present(stats.comments)) metrics.comments = stats.comments;
    out.set(item.id, metrics);
  }
  return out;
}

const ANALYTICS_COLUMNS: Record<string, keyof MetricValues> = {
  views: "views",
  likes: "likes",
  comments: "comments",
  estimatedMinutesWatched: "watchMinutes",
  averageViewDuration: "avgViewSeconds"
};

export function parseAnalyticsReport(body: unknown): Map<string, MetricValues> {
  const out = new Map<string, MetricValues>();
  const report = body as { columnHeaders?: Array<{ name?: string }>; rows?: unknown[][] } | null;
  const names = (report?.columnHeaders ?? []).map((header) => header?.name ?? "");
  const videoIndex = names.indexOf("video");
  if (videoIndex < 0 || !Array.isArray(report?.rows)) return out;
  for (const row of report.rows) {
    const id = row[videoIndex];
    if (typeof id !== "string") continue;
    const metrics: MetricValues = {};
    names.forEach((name, index) => {
      const key = ANALYTICS_COLUMNS[name];
      const value = row[index];
      if (key && typeof value === "number" && Number.isFinite(value)) metrics[key] = value;
    });
    out.set(id, metrics);
  }
  return out;
}

function startDateFor(videos: YoutubeVideo[]): string {
  const times = videos.map((video) => Date.parse(video.publishedAt)).filter((time) => Number.isFinite(time));
  if (times.length === 0) return EARLIEST_START;
  return dayKey(new Date(Math.min(...times)));
}

function dataApiUrl(ids: string[]): string {
  const query = new URLSearchParams({ part: "statistics", id: ids.join(","), maxResults: String(YOUTUBE_BATCH_SIZE) });
  return `${DATA_API}?${query}`;
}

function analyticsUrl(videos: YoutubeVideo[], now: Date): string {
  const query = new URLSearchParams({
    ids: "channel==MINE",
    startDate: startDateFor(videos),
    endDate: dayKey(now),
    metrics: "views,estimatedMinutesWatched,averageViewDuration",
    dimensions: "video",
    filters: `video==${videos.map((video) => video.id).join(",")}`,
    sort: "-views",
    maxResults: String(YOUTUBE_BATCH_SIZE)
  });
  return `${ANALYTICS_API}?${query}`;
}

export type QuotaDebit = (units: number) => Promise<{ ok: true; remaining: number } | { ok: false; reason: string; remaining: number }>;

export const YOUTUBE_QUOTA_NOTE = "YouTube's daily allowance for background reads is used up; it comes back at midnight Pacific time.";

const VIDEOS_LIST_UNITS = 1;

export async function fetchYoutubeMetrics(
  input: { token: string; videos: YoutubeVideo[]; now: Date; analytics?: "try" | "skip"; debit?: QuotaDebit },
  deps: HttpDeps = {}
): Promise<YoutubeOutcome> {
  const outcome: YoutubeOutcome = { ...newOutcome(), analytics: input.analytics === "skip" ? "skipped" : "used" };
  const headers = { Authorization: `Bearer ${input.token}` };
  let analyticsAvailable = input.analytics !== "skip";
  let analyticsRead = false;

  for (const batch of chunk(input.videos, YOUTUBE_BATCH_SIZE)) {
    if (input.debit) {
      const granted = await input.debit(VIDEOS_LIST_UNITS);
      if (!granted.ok) {
        outcome.stopped = { kind: "quota", message: YOUTUBE_QUOTA_NOTE };
        break;
      }
    }
    let counts: Map<string, MetricValues>;
    try {
      counts = parseVideoStatistics(
        await requestJson(dataApiUrl(batch.map((video) => video.id)), { label: "YouTube video statistics", headers }, deps)
      );
    } catch (error) {
      const stop = stopFromError(error);
      if (stop) {
        outcome.stopped = stop;
        break;
      }
      for (const video of batch) outcome.failed.push({ postId: video.id, message: error instanceof Error ? error.message : String(error) });
      continue;
    }

    const found = batch.filter((video) => counts.has(video.id));
    for (const video of batch) if (!counts.has(video.id)) outcome.gone.push(video.id);

    let watch = new Map<string, MetricValues>();
    if (analyticsAvailable && found.length > 0) {
      try {
        watch = parseAnalyticsReport(await requestJson(analyticsUrl(found, input.now), { label: "YouTube Analytics report", headers }, deps));
        analyticsRead = true;
      } catch (error) {
        const failure = classifyFailure(error);
        if (failure.kind === "auth") {
          outcome.stopped = stopFromError(error);
          break;
        }
        if (failure.kind === "scope") addNote(outcome, YOUTUBE_ANALYTICS_NOTE);
        if (failure.kind === "scope" || failure.kind === "rate") analyticsAvailable = false;
      }
    }

    for (const video of found) {
      const row = watch.get(video.id);
      outcome.results.set(video.id, {
        source: row ? "youtube-analytics" : "youtube-data-api",
        metrics: { ...(row ?? {}), ...counts.get(video.id)! }
      });
    }
  }

  if (input.analytics !== "skip") outcome.analytics = analyticsAvailable || analyticsRead ? "used" : "unavailable";
  return outcome;
}
