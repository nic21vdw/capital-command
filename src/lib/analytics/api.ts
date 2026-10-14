import { platformTotals, queryRows, rowsFromStore, type AnalyticsQuery } from "@/lib/analytics/query";
import type { AnalyticsReport, SyncSummary } from "@/lib/analytics/report";
import { SYNC_INTERVAL_MS } from "@/lib/analytics/schedule";
import { readMetrics } from "@/lib/analytics/store";
import { markerIsLive, syncInFlight } from "@/lib/analytics/sync";
import type { AnalyticsPlatform, AnalyticsStore, PostRecord } from "@/lib/analytics/types";
import { postKey } from "@/lib/analytics/types";

export type { AnalyticsReport, SyncSummary } from "@/lib/analytics/report";

function syncSummary(sync: AnalyticsStore["sync"], now: Date): SyncSummary {
  const completed = sync.lastCompletedAt ? Date.parse(sync.lastCompletedAt) : NaN;
  return {
    lastAttemptAt: sync.lastAttemptAt,
    lastCompletedAt: sync.lastCompletedAt,
    lastResult: sync.lastResult,
    lastError: sync.lastError,
    running: syncInFlight() !== null || markerIsLive(sync.running, now),
    nextDueAt: new Date(Number.isFinite(completed) ? completed + SYNC_INTERVAL_MS : now.getTime()).toISOString()
  };
}

export async function queryAnalytics(query: AnalyticsQuery = {}, now: Date = new Date()): Promise<AnalyticsReport> {
  const store = await readMetrics();
  const rows = rowsFromStore(store);
  const platforms = query.platform === undefined ? null : new Set(Array.isArray(query.platform) ? query.platform : [query.platform]);
  const scoped = platforms ? rows.filter((row) => platforms.has(row.platform)) : rows;
  return {
    generatedAt: now.toISOString(),
    sync: syncSummary(store.sync, now),
    accounts: Object.values(store.accounts).sort((a, b) => a.key.localeCompare(b.key)),
    posts: queryRows(rows, query, now),
    totals: { last7: platformTotals(scoped, 7, now), last28: platformTotals(scoped, 28, now) }
  };
}

export async function getPostMetrics(platform: AnalyticsPlatform, postId: string): Promise<PostRecord | null> {
  return (await readMetrics()).posts[postKey(platform, postId)] ?? null;
}
