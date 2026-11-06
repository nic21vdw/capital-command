import type { AnalyticsReport } from "@/lib/analytics/report";
import { MIN_POSTS_PER_ACCOUNT, SLOT_AGE_HOURS } from "@/lib/analytics/bestTimes";
import type { BestTimesResponse } from "@/lib/analytics/bestTimesApi";
import { accountOptionKey, accountOptionLabel, slotSummaryLine, suggestionAvailable } from "@/lib/analytics/bestTimesView";
import { topRows, type PlatformTotals, type SortKey } from "@/lib/analytics/query";
import { ANALYTICS_PLATFORMS, PLATFORM_LABEL } from "@/lib/analytics/types";
import { accountNotices, formatRate, syncStatusLine, type PerformanceView } from "@/lib/analytics/view";
import type { SurfaceControl, SurfaceField, SurfaceReading } from "@/lib/colateral/protocol";
import type { ExperimentReport } from "@/lib/experiments/evaluate";
import { experimentTitle, reasonLabel, statusCounts, variantLine } from "@/lib/experiments/view";
import { compactCount } from "@/lib/publisher/youtubeStatsShared";

export const PERFORMANCE_RANGES = ["7d", "28d", "90d", "all"] as const;
export type PerformanceRange = PerformanceView["range"];

export const PERFORMANCE_SORTS: SortKey[] = ["published", "views", "engagement", "title", "platform"];

export type SurfaceLoad = "loading" | "ready" | "error";

export type PerformanceSurfaceInput = {
  state: SurfaceLoad;
  report: AnalyticsReport | null;
  now: Date;
  view: PerformanceView;
  shown: number;
  experiments?: { state: SurfaceLoad; reports: ExperimentReport[]; timeZone?: string };
  slots?: { state: SurfaceLoad; report: BestTimesResponse | null; target: string | null; applying: boolean };
};

export const USE_SLOTS_HINT = "Rewrites the posting times in .env for every platform. Posts already booked keep the time they have.";

function slotsParts(slots: NonNullable<PerformanceSurfaceInput["slots"]>): {
  fields: SurfaceField[];
  controls: SurfaceControl[];
  readings: SurfaceReading[];
} {
  const accounts = slots.report?.accounts ?? [];
  const selected = accounts.find((account) => accountOptionKey(account) === slots.target) ?? null;
  const fields: SurfaceField[] =
    accounts.length > 1
      ? [{ id: "slots-account", label: "Suggested slots for", value: selected ? accountOptionKey(selected) : null, kind: "select", options: accounts.map(accountOptionKey) }]
      : [];
  const ready = selected !== null && suggestionAvailable(selected) && !slots.applying;
  const controls: SurfaceControl[] = [
    { id: "use-slots", label: "Use these slots", group: "Suggested slots", destructive: true, disabled: !ready, hint: USE_SLOTS_HINT }
  ];

  let value: string;
  if (slots.state === "loading") value = "Loading";
  else if (slots.state === "error" || !slots.report) value = "Could not read the suggestions";
  else if (!selected) value = `Not enough data yet. Slots are learned once an account has ${MIN_POSTS_PER_ACCOUNT} posts measured at ${SLOT_AGE_HOURS} hours old.`;
  else {
    value = [
      accountOptionLabel(selected),
      slotSummaryLine("Weekdays", selected.weekday),
      slotSummaryLine("Weekends", selected.weekend)
    ].join(". ");
  }
  return { fields, controls, readings: [{ label: "Suggested slots", value }] };
}

function experimentReadings(experiments: NonNullable<PerformanceSurfaceInput["experiments"]>): SurfaceReading[] {
  if (experiments.state === "loading") return [{ label: "Experiments", value: "Loading" }];
  if (experiments.state === "error") return [{ label: "Experiments", value: "Could not read the experiments" }];
  const readings: SurfaceReading[] = [{ label: "Experiments", value: statusCounts(experiments.reports) }];
  for (const report of experiments.reports) {
    readings.push({
      label: experimentTitle(report),
      value: [`${reasonLabel(report.reason)}: ${report.summary}`, ...report.variants.map((variant) => variantLine(variant, experiments.timeZone))].join("; ")
    });
  }
  return readings;
}

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

  const slotParts = input.slots ? slotsParts(input.slots) : null;
  if (slotParts) {
    fields.push(...slotParts.fields);
    controls.push(...slotParts.controls);
  }
  const extraReadings: SurfaceReading[] = [
    ...(input.experiments ? experimentReadings(input.experiments) : []),
    ...(slotParts ? slotParts.readings : [])
  ];

  if (state === "loading") return { summary, fields, controls, readings: [{ label: "Sync", value: "Loading" }, ...extraReadings] };
  if (state === "error" || !report) return { summary, fields, controls, readings: [{ label: "Sync", value: "Could not read the numbers" }, ...extraReadings] };

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
  readings.push(...extraReadings);

  return { summary, fields, controls, readings };
}
