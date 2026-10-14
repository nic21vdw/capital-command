import { readFile, stat } from "node:fs/promises";
import { dataPath } from "@/lib/paths";
import {
  ANALYTICS_PLATFORMS,
  METRIC_KEYS,
  emptyStore,
  postKey,
  type AccountSync,
  type AnalyticsStore,
  type MetricValues,
  type PostRecord,
  type Snapshot
} from "@/lib/analytics/types";
import { atomicWriteJson } from "@/lib/storage/atomic-json";
import { withFileLock } from "@/lib/storage/file-lock";

export function metricsFile(): string {
  return dataPath("analytics", "metrics.json");
}

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";

function metricValues(value: unknown): MetricValues {
  const out: MetricValues = {};
  if (!isRecord(value)) return out;
  for (const key of METRIC_KEYS) {
    const entry = value[key];
    if (typeof entry === "number" && Number.isFinite(entry)) out[key] = entry;
  }
  return out;
}

function snapshots(value: unknown): Snapshot[] {
  if (!Array.isArray(value)) return [];
  const out: Snapshot[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !isString(entry.date)) continue;
    out.push({ date: entry.date, at: isString(entry.at) ? entry.at : "", ...metricValues(entry) });
  }
  return out;
}

function normalizePost(value: unknown): PostRecord | null {
  if (!isRecord(value)) return null;
  const platform = ANALYTICS_PLATFORMS.find((candidate) => candidate === value.platform);
  if (!platform || !isString(value.postId) || !isString(value.publishedAt)) return null;
  const latest = isRecord(value.latest) && isString(value.latest.at) ? { at: value.latest.at, metrics: metricValues(value.latest.metrics) } : null;
  const record: PostRecord = {
    ...(value as unknown as PostRecord),
    key: postKey(platform, value.postId),
    platform,
    accountId: isString(value.accountId) ? value.accountId : `${platform}-primary`,
    itemId: isString(value.itemId) ? value.itemId : "",
    title: isString(value.title) ? value.title : "",
    caption: isString(value.caption) ? value.caption : "",
    status: ["ok", "unsupported", "error", "gone"].includes(String(value.status)) ? (value.status as PostRecord["status"]) : "ok",
    latest,
    history: snapshots(value.history),
    misses: typeof value.misses === "number" ? value.misses : 0
  };
  return record;
}

function normalizeAccount(value: unknown): AccountSync | null {
  if (!isRecord(value) || !isString(value.key) || !isString(value.status)) return null;
  const platform = ANALYTICS_PLATFORMS.find((candidate) => candidate === value.platform);
  if (!platform) return null;
  return value as unknown as AccountSync;
}

export function normalizeStore(raw: unknown): AnalyticsStore {
  const store = emptyStore();
  if (!isRecord(raw)) return store;
  if (isRecord(raw.posts)) {
    for (const entry of Object.values(raw.posts)) {
      const post = normalizePost(entry);
      if (post) store.posts[post.key] = post;
    }
  }
  if (isRecord(raw.accounts)) {
    for (const entry of Object.values(raw.accounts)) {
      const account = normalizeAccount(entry);
      if (account) store.accounts[account.key] = account;
    }
  }
  if (isRecord(raw.sync)) store.sync = { ...store.sync, ...(raw.sync as Partial<AnalyticsStore["sync"]>) };
  return store;
}

async function readFresh(): Promise<AnalyticsStore> {
  let text: string;
  try {
    text = await readFile(metricsFile(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw error;
  }
  try {
    return normalizeStore(JSON.parse(text));
  } catch (error) {
    throw new Error(
      `analytics/metrics.json could not be read (${error instanceof Error ? error.message : String(error)}). Fix or move the file; it was left untouched.`
    );
  }
}

type Cached = { file: string; mtimeMs: number; size: number; store: AnalyticsStore };
let cached: Cached | null = null;

export async function readMetrics(): Promise<AnalyticsStore> {
  const file = metricsFile();
  let info;
  try {
    info = await stat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw error;
  }
  if (cached && cached.file === file && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.store;
  const store = await readFresh();
  cached = { file, mtimeMs: info.mtimeMs, size: info.size, store };
  return store;
}

let queue: Promise<unknown> = Promise.resolve();

export function updateMetrics<T>(mutate: (store: AnalyticsStore) => T | Promise<T>): Promise<T> {
  const run = async () =>
    withFileLock(metricsFile(), async () => {
      const store = await readFresh();
      const result = await mutate(store);
      await atomicWriteJson(metricsFile(), store, { space: 0 });
      cached = null;
      return result;
    });
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
