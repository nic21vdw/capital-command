import { metricsAtAge } from "@/lib/analytics/atAge";
import { accountKey, type AnalyticsPlatform, type PostRecord } from "@/lib/analytics/types";
import { localCalendarParts } from "@/lib/publisher/time";

const HOUR = 3_600_000;

export const SLOT_AGE_HOURS = 48;
export const MIN_POSTS_PER_ACCOUNT = 20;
export const MIN_POSTS_PER_HOUR = 3;
export const SMOOTHING_PRIOR = 3;
export const MIN_SPACING_HOURS = 2;
const NEIGHBOUR_WEIGHT = 0.5;

export type DayType = "weekday" | "weekend";
export type Confidence = "low" | "medium" | "high";
export type SuggestionStatus = "ready" | "unchanged" | "not-enough-data";

export type HourStat = {
  hour: number;
  posts: number;
  meanViews: number;
  considered: boolean;
  smoothedLift: number;
};

export type SlotSuggestion = {
  dayType: DayType;
  status: SuggestionStatus;
  posts: number;
  hours: HourStat[];
  current: string[];
  times: string[];
  confidence: Confidence | null;
  basis: string | null;
  gainPercent: number | null;
  reason: string | null;
};

export type AccountSlots = {
  platform: AnalyticsPlatform;
  accountId: string;
  label: string | null;
  posts: number;
  weekday: SlotSuggestion;
  weekend: SlotSuggestion;
};

export type BestTimesReport = {
  generatedAt: string;
  timeZone: string;
  ageHours: number;
  accounts: AccountSlots[];
};

export type BestTimesOptions = {
  timeZone: string;
  now: Date;
  current: { weekday: string[]; weekend: string[] };
  labels?: Record<string, string | null | undefined>;
};

type Sample = { hour: number; views: number };

const SLOT_PLATFORMS: AnalyticsPlatform[] = ["youtube", "instagram", "facebook", "tiktok"];

function usable(post: PostRecord): boolean {
  if (!SLOT_PLATFORMS.includes(post.platform)) return false;
  if (post.status === "unsupported" || post.status === "gone") return false;
  if (post.format === "long-form") return false;
  return post.visibility === undefined || post.visibility === "public";
}

function sampleOf(post: PostRecord, timeZone: string): (Sample & { dayType: DayType }) | null {
  const metrics = metricsAtAge(post, SLOT_AGE_HOURS * HOUR);
  const views = metrics?.views ?? metrics?.reach;
  if (typeof views !== "number" || !Number.isFinite(views) || views < 0) return null;
  const local = localCalendarParts(post.publishedAt, timeZone);
  const dow = new Date(`${local.dateKey}T12:00:00.000Z`).getUTCDay();
  return { hour: Number(local.time.slice(0, 2)), views, dayType: dow === 0 || dow === 6 ? "weekend" : "weekday" };
}

const hourOf = (time: string) => Number(time.slice(0, 2));
const pad = (hour: number) => String(hour).padStart(2, "0");
const wrap = (hour: number) => (hour + 24) % 24;
const circularGap = (a: number, b: number) => Math.min(Math.abs(a - b), 24 - Math.abs(a - b));
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

function hourStats(samples: Sample[]): { stats: HourStat[]; smoothed: Map<number, number> } {
  if (samples.length === 0) return { stats: [], smoothed: new Map() };
  const byHour = new Map<number, number[]>();
  for (const sample of samples) byHour.set(sample.hour, [...(byHour.get(sample.hour) ?? []), sample.views]);
  const logMeans = new Map<number, number>();
  for (const [hour, views] of byHour) logMeans.set(hour, mean(views.map((value) => Math.log1p(value))));
  const overall = mean(samples.map((sample) => Math.log1p(sample.views)));

  const smoothed = new Map<number, number>();
  for (const hour of byHour.keys()) {
    let numerator = SMOOTHING_PRIOR * overall;
    let denominator = SMOOTHING_PRIOR;
    for (const [offset, weight] of [[-1, NEIGHBOUR_WEIGHT], [0, 1], [1, NEIGHBOUR_WEIGHT]] as const) {
      const neighbour = wrap(hour + offset);
      const count = byHour.get(neighbour)?.length ?? 0;
      if (count === 0) continue;
      numerator += weight * count * logMeans.get(neighbour)!;
      denominator += weight * count;
    }
    smoothed.set(hour, numerator / denominator);
  }

  const stats = [...byHour.entries()]
    .map(([hour, views]) => ({
      hour,
      posts: views.length,
      meanViews: mean(views),
      considered: views.length >= MIN_POSTS_PER_HOUR,
      smoothedLift: Math.round((Math.exp(smoothed.get(hour)! - overall) - 1) * 1000) / 1000
    }))
    .sort((a, b) => a.hour - b.hour);
  return { stats, smoothed };
}

function confidenceFor(posts: number, smallest: number): Confidence {
  if (posts >= 60 && smallest >= 6) return "high";
  if (posts >= 35 && smallest >= 4) return "medium";
  return "low";
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function suggest(dayType: DayType, samples: Sample[], current: string[]): SlotSuggestion {
  const { stats, smoothed } = hourStats(samples);
  const base: SlotSuggestion = {
    dayType,
    status: "not-enough-data",
    posts: samples.length,
    hours: stats,
    current,
    times: current,
    confidence: null,
    basis: null,
    gainPercent: null,
    reason: null
  };
  if (samples.length < MIN_POSTS_PER_ACCOUNT) {
    return {
      ...base,
      reason: `Not enough data yet: ${plural(samples.length, "post")} measured at ${SLOT_AGE_HOURS} hours old, and ${MIN_POSTS_PER_ACCOUNT} are needed.`
    };
  }

  const qualifying = stats.filter((stat) => stat.considered);
  const wanted = current.length;
  const ranked = [...qualifying].sort((a, b) => smoothed.get(b.hour)! - smoothed.get(a.hour)! || a.hour - b.hour);
  const picked: HourStat[] = [];
  for (const stat of ranked) {
    if (picked.length >= wanted) break;
    if (picked.every((chosen) => circularGap(chosen.hour, stat.hour) >= MIN_SPACING_HOURS)) picked.push(stat);
  }
  if (wanted === 0 || picked.length < wanted) {
    const shortfall =
      qualifying.length < wanted
        ? `only ${plural(qualifying.length, "hour")} ${qualifying.length === 1 ? "has" : "have"} ${MIN_POSTS_PER_HOUR} or more posts`
        : `only ${plural(picked.length, "hour")} with ${MIN_POSTS_PER_HOUR} or more posts ${picked.length === 1 ? "is" : "are"} at least ${MIN_SPACING_HOURS} hours apart`;
    return { ...base, reason: `Not enough data yet: ${shortfall}, and the grid has ${plural(wanted, "slot")} to fill.` };
  }

  const times = picked
    .map((stat) => current.find((time) => hourOf(time) === stat.hour) ?? `${pad(stat.hour)}:00`)
    .sort();
  const unchanged = times.length === current.length && [...current].sort().every((time, index) => time === times[index]);
  const smallest = Math.min(...picked.map((stat) => stat.posts));
  const largest = Math.max(...picked.map((stat) => stat.posts));

  const currentStats = current.map((time) => stats.find((stat) => stat.hour === hourOf(time) && stat.considered));
  const comparable = !unchanged && currentStats.every((stat) => stat !== undefined);
  const gain = comparable
    ? Math.exp(mean(picked.map((stat) => smoothed.get(stat.hour)!)) - mean(currentStats.map((stat) => smoothed.get(stat!.hour)!))) - 1
    : null;

  return {
    ...base,
    status: unchanged ? "unchanged" : "ready",
    times,
    confidence: confidenceFor(samples.length, smallest),
    basis: `${plural(samples.length, "post")}, ${smallest === largest ? smallest : `${smallest} to ${largest}`} per hour`,
    gainPercent: gain === null ? null : Math.round(gain * 1000) / 10,
    reason: unchanged ? "Your current slots already match your best hours." : null
  };
}

export function learnBestTimes(posts: PostRecord[], options: BestTimesOptions): BestTimesReport {
  const groups = new Map<string, { platform: AnalyticsPlatform; accountId: string; weekday: Sample[]; weekend: Sample[] }>();
  for (const post of posts) {
    if (!usable(post)) continue;
    const sample = sampleOf(post, options.timeZone);
    if (!sample) continue;
    const key = accountKey(post.platform, post.accountId);
    const group = groups.get(key) ?? { platform: post.platform, accountId: post.accountId, weekday: [], weekend: [] };
    group[sample.dayType].push({ hour: sample.hour, views: sample.views });
    groups.set(key, group);
  }

  const accounts = [...groups.entries()]
    .map(([key, group]): AccountSlots => ({
      platform: group.platform,
      accountId: group.accountId,
      label: options.labels?.[key] ?? null,
      posts: group.weekday.length + group.weekend.length,
      weekday: suggest("weekday", group.weekday, options.current.weekday),
      weekend: suggest("weekend", group.weekend, options.current.weekend)
    }))
    .sort((a, b) => b.posts - a.posts || a.platform.localeCompare(b.platform) || a.accountId.localeCompare(b.accountId));

  return { generatedAt: options.now.toISOString(), timeZone: options.timeZone, ageHours: SLOT_AGE_HOURS, accounts };
}
