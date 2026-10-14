import { engagementRate, engagements } from "@/lib/analytics/metrics";
import {
  ANALYTICS_PLATFORMS,
  type AnalyticsPlatform,
  type AnalyticsStore,
  type MetricSource,
  type MetricValues,
  type PostFormat,
  type PostRecord,
  type PostStatus
} from "@/lib/analytics/types";

const DAY = 86_400_000;
export const TREND_POINTS = 30;

export type PostRow = {
  key: string;
  platform: AnalyticsPlatform;
  accountId: string;
  postId: string;
  itemId: string;
  format: PostFormat;
  title: string;
  caption: string;
  publishedAt: string;
  url: string | null;
  carouselId: string | null;
  visibility: string | null;
  status: PostStatus;
  note: string | null;
  source: MetricSource | null;
  measured: boolean;
  metrics: MetricValues;
  engagements: number | null;
  engagementRate: number | null;
  syncedAt: string | null;
  trend: number[];
};

export type SortKey = "published" | "views" | "engagement" | "title" | "platform";
export type SortDirection = "asc" | "desc";

export type AnalyticsQuery = {
  platform?: AnalyticsPlatform | AnalyticsPlatform[];
  format?: PostFormat;
  since?: Date | string;
  until?: Date | string;
  sort?: SortKey;
  direction?: SortDirection;
  top?: number;
};

export type PlatformTotals = {
  platform: AnalyticsPlatform;
  posts: number;
  measured: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  engagements: number;
  engagementRate: number | null;
};

function urlFor(record: PostRecord): string | null {
  return record.platform === "youtube" ? `https://www.youtube.com/watch?v=${encodeURIComponent(record.postId)}` : null;
}

function trendOf(record: PostRecord): number[] {
  const values: number[] = [];
  for (const snapshot of record.history) {
    const value = snapshot.views ?? snapshot.reach;
    if (typeof value === "number") values.push(value);
  }
  return values.slice(-TREND_POINTS);
}

export function rowFromRecord(record: PostRecord): PostRow {
  const metrics = record.latest?.metrics ?? {};
  return {
    key: record.key,
    platform: record.platform,
    accountId: record.accountId,
    postId: record.postId,
    itemId: record.itemId,
    format: record.format,
    title: record.title,
    caption: record.caption,
    publishedAt: record.publishedAt,
    url: urlFor(record),
    carouselId: record.carouselId ?? null,
    visibility: record.visibility ?? null,
    status: record.status,
    note: record.note ?? null,
    source: record.source ?? null,
    measured: record.latest !== null,
    metrics,
    engagements: engagements(metrics),
    engagementRate: engagementRate(metrics),
    syncedAt: record.syncedAt ?? null,
    trend: trendOf(record)
  };
}

export function rowsFromStore(store: AnalyticsStore): PostRow[] {
  return Object.values(store.posts).map(rowFromRecord);
}

export function parseSince(value: string | null | undefined, now: Date): Date | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  const days = /^(\d{1,4})d$/.exec(text);
  if (days) return new Date(now.getTime() - Number(days[1]) * DAY);
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function parseUntil(value: Date | string, now: Date): Date | null {
  if (value instanceof Date) return value;
  const parsed = parseSince(value, now);
  if (!parsed) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? new Date(parsed.getTime() + DAY - 1) : parsed;
}

function numberFor(row: PostRow, sort: SortKey): number | null {
  if (sort === "views") return row.metrics.views ?? null;
  if (sort === "engagement") return row.engagementRate;
  return null;
}

const newestFirst = (a: PostRow, b: PostRow) => b.publishedAt.localeCompare(a.publishedAt);

export function sortRows(rows: PostRow[], sort: SortKey, direction?: SortDirection): PostRow[] {
  const defaults: SortDirection = sort === "title" || sort === "platform" ? "asc" : "desc";
  const sign = (direction ?? defaults) === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort === "views" || sort === "engagement") {
      const left = numberFor(a, sort);
      const right = numberFor(b, sort);
      if (left === null && right === null) return newestFirst(a, b);
      if (left === null) return 1;
      if (right === null) return -1;
      return sign * (left - right) || newestFirst(a, b);
    }
    if (sort === "title") return sign * a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || newestFirst(a, b);
    if (sort === "platform") return sign * a.platform.localeCompare(b.platform) || newestFirst(a, b);
    return sign * a.publishedAt.localeCompare(b.publishedAt);
  });
}

export function topRows(rows: PostRow[], count: number, by: "views" | "engagement" = "views"): PostRow[] {
  const measured = rows.filter((row) => row.measured && numberFor(row, by) !== null);
  return sortRows(measured, by, "desc").slice(0, Math.max(0, count));
}

export function queryRows(rows: PostRow[], query: AnalyticsQuery, now: Date): PostRow[] {
  const platforms = query.platform === undefined ? null : new Set(Array.isArray(query.platform) ? query.platform : [query.platform]);
  const since = query.since instanceof Date ? query.since : query.since ? parseSince(query.since, now) : null;
  const until = query.until ? parseUntil(query.until, now) : null;

  const filtered = rows.filter((row) => {
    if (platforms && !platforms.has(row.platform)) return false;
    if (query.format && row.format !== query.format) return false;
    const published = Date.parse(row.publishedAt);
    if (since && published < since.getTime()) return false;
    if (until && published > until.getTime()) return false;
    return true;
  });

  if (query.top !== undefined) {
    const by = query.sort === "engagement" ? "engagement" : "views";
    return topRows(filtered, query.top, by);
  }
  return sortRows(filtered, query.sort ?? "published", query.direction);
}

export function platformTotals(rows: PostRow[], days: number, now: Date): PlatformTotals[] {
  const from = now.getTime() - days * DAY;
  const totals = new Map<AnalyticsPlatform, PlatformTotals>();
  for (const row of rows) {
    const published = Date.parse(row.publishedAt);
    if (published < from || published > now.getTime()) continue;
    const entry =
      totals.get(row.platform) ??
      ({ platform: row.platform, posts: 0, measured: 0, views: 0, likes: 0, comments: 0, shares: 0, saves: 0, engagements: 0, engagementRate: null } as PlatformTotals);
    entry.posts += 1;
    if (row.measured) {
      entry.measured += 1;
      entry.views += row.metrics.views ?? 0;
      entry.likes += row.metrics.likes ?? 0;
      entry.comments += row.metrics.comments ?? row.metrics.replies ?? 0;
      entry.shares += row.metrics.shares ?? 0;
      entry.saves += row.metrics.saves ?? 0;
      entry.engagements += row.engagements ?? 0;
    }
    totals.set(row.platform, entry);
  }
  return ANALYTICS_PLATFORMS.flatMap((platform) => {
    const entry = totals.get(platform);
    if (!entry) return [];
    entry.engagementRate = entry.views > 0 && entry.measured > 0 ? entry.engagements / entry.views : null;
    return [entry];
  });
}
