import type { MetricKey, MetricValues, PostRecord } from "@/lib/analytics/types";

const HOUR = 3_600_000;

export const MAX_BRACKET_GAP_MS = 4 * 24 * HOUR;

const RUNNING_TOTALS: MetricKey[] = [
  "views",
  "reach",
  "likes",
  "comments",
  "shares",
  "saves",
  "replies",
  "reposts",
  "quotes",
  "watchMinutes"
];

type Point = { t: number; metrics: MetricValues | null };

function pointsOf(record: PostRecord, publishedMs: number): Point[] {
  const points: Point[] = [];
  for (const snapshot of record.history) {
    const stamp = Date.parse(snapshot.at) || Date.parse(`${snapshot.date}T12:00:00.000Z`);
    if (!Number.isFinite(stamp)) continue;
    const t = stamp - publishedMs;
    if (t > 0) points.push({ t, metrics: snapshot });
  }
  return points.sort((a, b) => a.t - b.t);
}

export function metricsAtAge(record: PostRecord, ageMs: number): MetricValues | null {
  const publishedMs = Date.parse(record.publishedAt);
  if (!Number.isFinite(publishedMs) || ageMs <= 0) return null;
  const points = pointsOf(record, publishedMs);
  const next = points.find((point) => point.t >= ageMs);
  if (!next || !next.metrics) return null;

  const before = points.filter((point) => point.t < ageMs);
  const previous: Point = before.length > 0 ? before[before.length - 1] : { t: 0, metrics: null };
  if (next.t - previous.t > MAX_BRACKET_GAP_MS && next.t !== ageMs) return null;

  const fraction = next.t === previous.t ? 1 : (ageMs - previous.t) / (next.t - previous.t);
  const out: MetricValues = {};
  for (const key of RUNNING_TOTALS) {
    const end = next.metrics[key];
    if (typeof end !== "number") continue;
    if (next.t === ageMs) {
      out[key] = end;
      continue;
    }
    const start = previous.metrics === null ? 0 : previous.metrics[key];
    if (typeof start !== "number") continue;
    out[key] = start + (end - start) * fraction;
  }
  return out;
}
