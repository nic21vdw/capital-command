import {
  ENGAGEMENT_KEYS,
  postKey,
  type FetchedPost,
  type MetricValues,
  type PostRecord,
  type Snapshot,
  type Target
} from "@/lib/analytics/types";

export const MAX_HISTORY_DAYS = 90;
export const FINAL_AFTER_DAYS = 90;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MINUTE = 60_000;
const FRESH_WEEK_DAYS = 7;
const FRESH_WEEK_GAP_MS = 5 * HOUR;
const MONTH_DAYS = 30;
const MONTH_GAP_MS = 20 * HOUR;
const OLDER_GAP_MS = 70 * HOUR;
const ERROR_BACKOFF_MS = 30 * MINUTE;
const GONE_REPROBE_MS = 7 * DAY;

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function engagements(metrics: MetricValues): number | null {
  let total = 0;
  let seen = false;
  for (const key of ENGAGEMENT_KEYS) {
    const value = metrics[key];
    if (typeof value === "number") {
      total += value;
      seen = true;
    }
  }
  return seen ? total : null;
}

export function engagementRate(metrics: MetricValues): number | null {
  const total = engagements(metrics);
  const denominator = metrics.views ?? metrics.reach;
  if (total === null || !denominator || denominator <= 0) return null;
  return total / denominator;
}

function definedOnly(metrics: MetricValues): MetricValues {
  const out: MetricValues = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key as keyof MetricValues] = value;
  }
  return out;
}

export function newPostRecord(target: Target): PostRecord {
  const record: PostRecord = {
    key: postKey(target.platform, target.postId),
    platform: target.platform,
    accountId: target.accountId,
    postId: target.postId,
    itemId: target.itemId,
    format: target.format,
    title: target.title,
    caption: target.caption,
    publishedAt: target.publishedAt,
    status: "ok",
    latest: null,
    history: [],
    misses: 0
  };
  if (target.carouselId) record.carouselId = target.carouselId;
  if (target.visibility) record.visibility = target.visibility;
  return record;
}

export function postAgeDays(record: Pick<PostRecord, "publishedAt">, now: Date): number {
  const published = Date.parse(record.publishedAt);
  return Number.isFinite(published) ? (now.getTime() - published) / DAY : 0;
}

export function recordSnapshot(record: PostRecord, fetched: FetchedPost, now: Date): PostRecord {
  const metrics = definedOnly(fetched.metrics);
  const date = dayKey(now);
  const entry: Snapshot = { date, at: now.toISOString(), ...metrics };
  const history = [...record.history.filter((snapshot) => snapshot.date !== date), entry]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_HISTORY_DAYS);
  const next: PostRecord = {
    ...record,
    status: "ok",
    source: fetched.source,
    latest: { at: now.toISOString(), metrics },
    history,
    syncedAt: now.toISOString(),
    attemptedAt: now.toISOString(),
    misses: 0
  };
  delete next.note;
  if (postAgeDays(record, now) > FINAL_AFTER_DAYS) next.final = true;
  return next;
}

export function dueForSync(record: PostRecord | undefined, now: Date, options: { force?: boolean } = {}): boolean {
  if (!record) return true;
  if (record.status === "unsupported" || record.final) return false;
  if (record.status === "gone") {
    const looked = record.attemptedAt ? Date.parse(record.attemptedAt) : NaN;
    return Boolean(options.force) || !Number.isFinite(looked) || now.getTime() - looked >= GONE_REPROBE_MS;
  }

  const attempted = record.attemptedAt ? Date.parse(record.attemptedAt) : NaN;
  if (!options.force && record.status === "error" && Number.isFinite(attempted) && now.getTime() - attempted < ERROR_BACKOFF_MS) {
    return false;
  }

  const age = postAgeDays(record, now);
  if (age > FINAL_AFTER_DAYS) return true;
  if (options.force) return true;
  if (!record.syncedAt) return true;

  const synced = Date.parse(record.syncedAt);
  if (!Number.isFinite(synced)) return true;
  const gap = age <= FRESH_WEEK_DAYS ? FRESH_WEEK_GAP_MS : age <= MONTH_DAYS ? MONTH_GAP_MS : OLDER_GAP_MS;
  return now.getTime() - synced >= gap;
}
