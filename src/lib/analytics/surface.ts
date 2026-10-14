import type { AnalyticsReport } from "@/lib/analytics/report";
import { topRows, type PlatformTotals, type SortKey } from "@/lib/analytics/query";
import { ANALYTICS_PLATFORMS, PLATFORM_LABEL } from "@/lib/analytics/types";
import { accountNotices, formatRate, syncStatusLine, type PerformanceView } from "@/lib/analytics/view";
import type { SurfaceControl, SurfaceField, SurfaceReading } from "@/lib/colateral/protocol";
import { compactCount } from "@/lib/publisher/youtubeStatsShared";

export const PERFORMANCE_RANGES = ["7d", "28d", "90d", "all"] as const;
export type PerformanceRange = PerformanceView["range"];

export const PERFORMANCE_SORTS: SortKey[] = ["published", "views", "engagement", "title", "platform"];

export type PerformanceSurfaceInput = {
  state: "loading" | "ready" | "error";
  report: AnalyticsReport | null;
  now: Date;
  view: PerformanceView;
  shown: number;
};

function totalsText(totals: PlatformTotals): string {
  const parts = [`${totals.posts} ${totals.posts === 1 ? "post" : "posts"}`, `${compactCount(totals.views)} views`];
  if (totals.engagementRate !== null) parts.push(`${formatRate(totals.engagementRate)} engagement`);
  return parts.join(", ");
}

export function buildPerformanceSurface(input: PerformanceSurfaceInput): {
  summary: string;
  fields: SurfaceField[];
  controls: SurfaceControl[];
  readings: SurfaceReading[];
} {
  const { state, report, now, view } = input;
  const summary = "How every published post performed: views, engagement and trend per platform, synced every 6 hours.";

  const fields: SurfaceField[] = [
    { id: "platform", label: "Platform", value: view.platform, kind: "select", options: ["all", ...ANALYTICS_PLATFORMS] },
    { id: "range", label: "Published", value: view.range, kind: "select", options: [...PERFORMANCE_RANGES] },
    { id: "sort", label: "Sort by", value: view.sort, kind: "select", options: [...PERFORMANCE_SORTS] }
  ];

  const controls: SurfaceControl[] = [
    { id: "sync-now", label: "Sync now", group: "Sync", disabled: report?.sync.running ?? false }
  ];

  if (state === "loading") return { summary, fields, controls, readings: [{ label: "Sync", value: "Loading" }] };
  if (state === "error" || !report) return { summary, fields, controls, readings: [{ label: "Sync", value: "Could not read the numbers" }] };

  const readings: SurfaceReading[] = [{ label: "Sync", value: syncStatusLine(report.sync, now) }];
  for (const [days, totals] of [
    [7, report.totals.last7],
    [28, report.totals.last28]
  ] as const) {
    for (const entry of totals) readings.push({ label: `${PLATFORM_LABEL[entry.platform]}, last ${days} days`, value: totalsText(entry) });
  }

  const top = topRows(report.posts, 10, "views");
  readings.push({
    label: "Top posts",
    value:
      top
        .map((row, index) => `${index + 1}. ${row.title || row.caption.slice(0, 60)} (${PLATFORM_LABEL[row.platform]}) ${compactCount(row.metrics.views ?? 0)} views`)
        .join("; ") || "None measured yet"
  });
  readings.push({ label: "Posts shown", value: String(input.shown) });
  readings.push({ label: "Needs attention", value: accountNotices(report.accounts, now).map((notice) => notice.text).join("; ") || "Nothing" });

  return { summary, fields, controls, readings };
}
