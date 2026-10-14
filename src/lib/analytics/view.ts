import { platformTotals, queryRows, topRows, type PlatformTotals, type PostRow, type SortDirection, type SortKey } from "@/lib/analytics/query";
import type { AnalyticsReport, SyncSummary } from "@/lib/analytics/report";
import type { AccountSync, AnalyticsPlatform, MetricSource } from "@/lib/analytics/types";
import { accountDisplayName } from "@/lib/platform-health/types";
import { agoLabel } from "@/lib/publisher/youtubeStatsShared";

export type NoticeTone = "danger" | "warning" | "info";

export type AccountNotice = { text: string; tone: NoticeTone; platform: AccountSync["platform"]; accountId: string };

export function sparklinePoints(values: number[], width: number, height: number): string | null {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = span === 0 ? height / 2 : height - ((value - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function formatRate(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return "-";
  return `${Number((rate * 100).toFixed(1))}%`;
}

export function syncStatusLine(sync: SyncSummary, now: Date): string {
  if (sync.running) return "Syncing now";
  if (sync.lastResult === "error") {
    const good = sync.lastCompletedAt ? ` (last good sync ${agoLabel(sync.lastCompletedAt, now)})` : "";
    return `Last sync failed: ${sync.lastError ?? "unknown error"}${good}`;
  }
  if (sync.lastCompletedAt) return `Synced ${agoLabel(sync.lastCompletedAt, now)}`;
  return "Never synced yet";
}

function waitLabel(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return minutes < 60 ? `${minutes} min` : `${Math.ceil(minutes / 60)} h`;
}

export function accountNotices(accounts: AccountSync[], now: Date): AccountNotice[] {
  const notices: AccountNotice[] = [];
  for (const account of accounts) {
    const name = accountDisplayName(account.platform, account.label);
    const note = account.note ? `: ${account.note}` : "";
    const base = { platform: account.platform, accountId: account.accountId };
    switch (account.status) {
      case "paused-auth":
        notices.push({ ...base, tone: "danger", text: `${name} needs reconnecting${note}` });
        break;
      case "rate-limited": {
        const wait = account.backoffUntil ? Date.parse(account.backoffUntil) - now.getTime() : 0;
        notices.push({ ...base, tone: "warning", text: `${name} is rate limited; trying again in ${waitLabel(Math.max(wait, 0))}` });
        break;
      }
      case "unsupported":
        notices.push({ ...base, tone: "info", text: `${name}${note || ": not measured"}` });
        break;
      case "not-connected":
        notices.push({ ...base, tone: "info", text: `${name} is not connected, so its posts are not measured.` });
        break;
      case "error":
        notices.push({ ...base, tone: "warning", text: `${name}${note || ": the last read failed"}` });
        break;
      case "ok":
        if (account.note) notices.push({ ...base, tone: "info", text: `${name}${note}` });
        break;
    }
  }
  return notices;
}

const SOURCE_LABELS: Record<MetricSource, string> = {
  "youtube-analytics": "YouTube Analytics",
  "youtube-data-api": "YouTube Data API",
  "instagram-insights": "Instagram insights",
  "instagram-basic": "Likes and comments only",
  "facebook-insights": "Facebook insights",
  "facebook-basic": "Reactions and comments only",
  "threads-insights": "Threads insights",
  "tiktok-video-query": "TikTok video query"
};

export function sourceLabel(source: MetricSource | null): string {
  return source ? SOURCE_LABELS[source] : "";
}

export type PerformanceView = {
  platform: AnalyticsPlatform | "all";
  range: "7d" | "28d" | "90d" | "all";
  sort: SortKey;
  direction: SortDirection;
};

export type DerivedPerformance = {
  rows: PostRow[];
  top: PostRow[];
  totals: { last7: PlatformTotals[]; last28: PlatformTotals[] };
  notices: AccountNotice[];
};

export function derivePerformance(report: AnalyticsReport, view: PerformanceView, now: Date): DerivedPerformance {
  const platform = view.platform === "all" ? undefined : view.platform;
  const rows = queryRows(
    report.posts,
    { platform, since: view.range === "all" ? undefined : view.range, sort: view.sort, direction: view.direction },
    now
  );
  const scoped = platform ? report.posts.filter((row) => row.platform === platform) : report.posts;
  return {
    rows,
    top: topRows(rows, 10, "views"),
    totals: { last7: platformTotals(scoped, 7, now), last28: platformTotals(scoped, 28, now) },
    notices: accountNotices(report.accounts, now)
  };
}
