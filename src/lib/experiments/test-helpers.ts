import type { PostRecord } from "@/lib/analytics/types";
import { DEFAULT_WINDOW_HOURS, type Experiment, type ExperimentKind, type ExperimentVariant, type VariantOrigin } from "@/lib/experiments/types";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const NOW = new Date("2026-10-20T15:00:00.000Z");

type PostOptions = {
  platform?: PostRecord["platform"];
  postId: string;
  itemId?: string;
  accountId?: string;
  publishedAt?: string | Date;
  views: number | null;
  likes?: number;
  comments?: number;
  windowHours?: number;
  status?: PostRecord["status"];
};

export function postRecord(options: PostOptions): PostRecord {
  const platform = options.platform ?? "youtube";
  const publishedAt = new Date(options.publishedAt ?? new Date(NOW.getTime() - 30 * DAY)).toISOString();
  const windowMs = (options.windowHours ?? DEFAULT_WINDOW_HOURS) * HOUR;
  const published = Date.parse(publishedAt);
  const history =
    options.views === null
      ? []
      : [windowMs, windowMs + DAY].map((offset, index) => {
          const at = new Date(published + offset).toISOString();
          const scale = index === 0 ? 1 : 1.3;
          return {
            date: at.slice(0, 10),
            at,
            views: options.views! * scale,
            likes: (options.likes ?? 0) * scale,
            comments: (options.comments ?? 0) * scale
          };
        });
  return {
    key: `${platform}:${options.postId}`,
    platform,
    accountId: options.accountId ?? `${platform}-primary`,
    postId: options.postId,
    itemId: options.itemId ?? `item-${options.postId}`,
    format: "video",
    title: `Post ${options.postId}`,
    caption: "",
    publishedAt,
    status: options.status ?? "ok",
    latest: history.length > 0 ? { at: history[history.length - 1].at, metrics: { views: history[history.length - 1].views } } : null,
    history,
    misses: 0
  };
}

export function baselinePosts(platform: PostRecord["platform"], accountId: string, views: number[], likesRate = 0): PostRecord[] {
  return views.map((count, index) =>
    postRecord({
      platform,
      accountId,
      postId: `base-${platform}-${accountId}-${index}`,
      views: count,
      likes: Math.round(count * likesRate),
      publishedAt: new Date(NOW.getTime() - (40 + index) * DAY)
    })
  );
}

export function variant(
  id: string,
  placements: Array<{ platform?: PlatformId; itemId: string; publishAt: string; accountId?: string }>,
  value = `Title ${id}`,
  origin: VariantOrigin = "edited"
): ExperimentVariant {
  return {
    id,
    value,
    origin,
    placements: placements.map((entry) => ({
      platform: entry.platform ?? "youtube",
      accountId: entry.accountId ?? `${entry.platform ?? "youtube"}-primary`,
      itemId: entry.itemId,
      publishAt: entry.publishAt
    }))
  };
}

export function experiment(variants: ExperimentVariant[], overrides: Partial<Experiment> = {}, kind: ExperimentKind = "title"): Experiment {
  return {
    id: "exp1",
    createdAt: new Date(NOW.getTime() - 10 * DAY).toISOString(),
    kind,
    source: { label: "Clip about agents", jobId: "job1", file: "clip.mp4" },
    windowHours: DEFAULT_WINDOW_HOURS,
    variants,
    ...overrides
  };
}

export function queueItem(
  id: string,
  publishAt: string,
  platforms: Partial<Record<PlatformId, "published" | "pending" | "failed" | "scheduled">> = { youtube: "published" },
  overrides: Partial<QueueItem> = {}
): QueueItem {
  return {
    id,
    clipPath: "data/clips/outputs/job1/clip.mp4",
    title: `Title for ${id}`,
    caption: "",
    hashtags: [],
    publishAt,
    visibility: "public",
    createdAt: publishAt,
    jobId: "job1",
    platforms: Object.fromEntries(
      Object.entries(platforms).map(([platform, status]) => [
        platform,
        { status, attempts: 0, ...(status === "published" ? { publishedAt: publishAt, postId: `${id}-${platform}` } : {}) }
      ])
    ),
    ...overrides
  } as QueueItem;
}
