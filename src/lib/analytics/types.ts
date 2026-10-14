export const ANALYTICS_PLATFORMS = ["youtube", "instagram", "facebook", "threads", "tiktok"] as const;

export type AnalyticsPlatform = (typeof ANALYTICS_PLATFORMS)[number];

export const PLATFORM_LABEL: Record<AnalyticsPlatform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  tiktok: "TikTok"
};

export const METRIC_KEYS = [
  "views",
  "reach",
  "likes",
  "comments",
  "shares",
  "saves",
  "replies",
  "reposts",
  "quotes",
  "watchMinutes",
  "avgViewSeconds"
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export type MetricValues = Partial<Record<MetricKey, number>>;

export const ENGAGEMENT_KEYS: MetricKey[] = ["likes", "comments", "shares", "saves", "replies", "reposts", "quotes"];

export type MetricSource =
  | "youtube-analytics"
  | "youtube-data-api"
  | "instagram-insights"
  | "instagram-basic"
  | "facebook-insights"
  | "facebook-basic"
  | "threads-insights"
  | "tiktok-video-query";

export type PostFormat = "video" | "long-form" | "carousel" | "image" | "text";

export type PostStatus = "ok" | "unsupported" | "error" | "gone";

export type Snapshot = MetricValues & { date: string; at: string };

export type PostRecord = {
  key: string;
  platform: AnalyticsPlatform;
  accountId: string;
  postId: string;
  itemId: string;
  format: PostFormat;
  title: string;
  caption: string;
  publishedAt: string;
  carouselId?: string;
  visibility?: string;
  status: PostStatus;
  note?: string;
  source?: MetricSource;
  latest: { at: string; metrics: MetricValues } | null;
  history: Snapshot[];
  syncedAt?: string;
  attemptedAt?: string;
  final?: boolean;
  misses: number;
};

export type AccountSyncStatus = "ok" | "paused-auth" | "rate-limited" | "unsupported" | "not-connected" | "error";

export type AccountSync = {
  key: string;
  platform: AnalyticsPlatform;
  accountId: string;
  label: string | null;
  status: AccountSyncStatus;
  note: string | null;
  at: string;
  backoffUntil?: string;
  source?: MetricSource;
  posts: number;
};

export type SyncResult = "ok" | "partial" | "error";

export type SyncMeta = {
  lastAttemptAt: string | null;
  lastCompletedAt: string | null;
  lastResult: SyncResult | null;
  lastError: string | null;
  running: { pid: number; startedAt: string } | null;
};

export type AnalyticsStore = {
  version: 1;
  posts: Record<string, PostRecord>;
  accounts: Record<string, AccountSync>;
  sync: SyncMeta;
};

export type Target = {
  platform: AnalyticsPlatform;
  accountId: string;
  postId: string;
  itemId: string;
  format: PostFormat;
  title: string;
  caption: string;
  publishedAt: string;
  carouselId?: string;
  visibility?: string;
};

export type FetchedPost = { metrics: MetricValues; source: MetricSource };

export function postKey(platform: AnalyticsPlatform, postId: string): string {
  return `${platform}:${postId}`;
}

export function accountKey(platform: AnalyticsPlatform, accountId: string): string {
  return `${platform}:${accountId}`;
}

export function emptyStore(): AnalyticsStore {
  return {
    version: 1,
    posts: {},
    accounts: {},
    sync: { lastAttemptAt: null, lastCompletedAt: null, lastResult: null, lastError: null, running: null }
  };
}
