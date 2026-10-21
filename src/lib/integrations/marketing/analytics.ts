import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { dataRoot } from "@/lib/paths";
import { platformTotals, rowFromRecord, sortRows, type PlatformTotals, type PostRow } from "@/lib/analytics/query";
import { ANALYTICS_PLATFORMS, METRIC_KEYS, accountKey, postKey,
  type AccountSync, type AnalyticsPlatform, type MetricValues, type PostRecord, type Snapshot } from "@/lib/analytics/types";

/** Assigned by the trusted owner registry; never accepted from query/body fields. */
export type TrustedAnalyticsScope = {
  ownerId: string;
  accounts: readonly { platform: AnalyticsPlatform; accountId: string }[];
};
export type MarketingAnalyticsFilters = {
  platform?: AnalyticsPlatform;
  windowDays?: 7 | 28 | 90;
  sort?: "published" | "views" | "engagement";
  limit?: number;
};
export type SavedAnalyticsPost = Pick<PostRow, "key" | "platform" | "accountId" | "postId" | "format" | "title" |
  "publishedAt" | "status" | "measured" | "metrics" | "engagements" | "engagementRate" | "syncedAt" | "trend">;
type NullableTotals = Omit<PlatformTotals, "views" | "likes" | "comments" | "shares" | "saves" | "engagements"> & {
  views: number | null; likes: number | null; comments: number | null; shares: number | null;
  saves: number | null; engagements: number | null;
};
export type MarketingAnalyticsSnapshot = {
  connection: { state: "read_only" | "unavailable"; message: string };
  snapshot: "persisted_metrics";
  store: { state: "loaded" | "missing" | "not_configured" | "unavailable";
    reason?: "scope_unavailable" | "malformed" | "unreadable" | "outside_root" | "too_large" | "changed" };
  generatedAt: string;
  filters: Required<Omit<MarketingAnalyticsFilters, "platform">> & { platform?: AnalyticsPlatform };
  accounts: { platform: AnalyticsPlatform; accountId: string; label: string | null; status: AccountSync["status"]; at: string }[] | null;
  posts: SavedAnalyticsPost[] | null;
  totals: { window: NullableTotals[]; last7: NullableTotals[]; last28: NullableTotals[] } | null;
  counts: { matchingPosts: number; returnedPosts: number; measuredPosts: number; truncated: boolean } | null;
  freshness: { storeModifiedAt: string; latestMeasurementAt: string | null; oldestMeasurementAt: string | null } | null;
};

export class MarketingAnalyticsInputError extends Error { readonly code = "invalid"; }
const DAY = 86_400_000;
const MAX_BYTES = 128 * 1024 * 1024;
const MAX_ROWS = 100_000;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === "string" && ID.test(value) && !value.includes("..");
const platform = (value: unknown): value is AnalyticsPlatform => ANALYTICS_PLATFORMS.includes(value as AnalyticsPlatform);
const date = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
const iso = (value: string) => new Date(value).toISOString();
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
class StoreError extends Error {
  constructor(readonly reason: NonNullable<MarketingAnalyticsSnapshot["store"]["reason"]>) { super("Saved metrics unavailable."); }
}
const malformed = (): never => { throw new StoreError("malformed"); };

function safeText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  return value.slice(0, maximum)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/(?:https?:\/\/|file:\/\/|upload:\/\/)[^\s<>"']+/gi, "[link]")
    .replace(/(?:[a-z]:[\\/]|\\\\|\/(?:Users|home|var|tmp|etc|data)\/)[^\s<>"']+/gi, "[private path]")
    .replace(/\b(?:Bearer|Basic)\s+[a-z0-9._~+/=-]+/gi, "[credential]")
    .replace(/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|password|token|secret)\s*[:=]\s*[^\s,;]+/gi, "[credential]");
}

function filters(value: MarketingAnalyticsFilters): MarketingAnalyticsSnapshot["filters"] {
  if (!object(value) || Object.keys(value).some((key) => !["platform", "windowDays", "sort", "limit"].includes(key)) ||
    (value.platform !== undefined && !platform(value.platform)) ||
    (value.windowDays !== undefined && ![7, 28, 90].includes(value.windowDays)) ||
    (value.sort !== undefined && !["published", "views", "engagement"].includes(value.sort)) ||
    (value.limit !== undefined && (!Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 100))) {
    throw new MarketingAnalyticsInputError("Use an allowed platform, 7/28/90 day window, sort and limit from 1 to 100.");
  }
  return { windowDays: value.windowDays ?? 28, sort: value.sort ?? "published", limit: value.limit ?? 100,
    ...(value.platform ? { platform: value.platform } : {}) };
}

function validScope(value: unknown, ownerId: string): value is TrustedAnalyticsScope {
  if (typeof ownerId !== "string" || !ownerId.trim() || ownerId.length > 128 || /[\u0000-\u001f\u007f]/.test(ownerId) || !object(value) ||
      value.ownerId !== ownerId || !Array.isArray(value.accounts) || value.accounts.length < 1 || value.accounts.length > 100) return false;
  const seen = new Set<string>();
  return value.accounts.every((account: unknown) => {
    if (!object(account) || !platform(account.platform) || !identifier(account.accountId)) return false;
    const key = accountKey(account.platform, account.accountId);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function values(value: unknown): MetricValues {
  if (!object(value)) return malformed();
  const result: MetricValues = {};
  for (const key of METRIC_KEYS) {
    if (!own(value, key)) continue;
    const number = value[key];
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0) return malformed();
    result[key] = number;
  }
  return result;
}

function parsePost(key: string, raw: Record<string, unknown>): PostRecord {
  if (!platform(raw.platform) || !identifier(raw.accountId) || !identifier(raw.postId) ||
      key !== postKey(raw.platform, raw.postId) || raw.key !== key || !date(raw.publishedAt) ||
      !["video", "long-form", "carousel", "image", "text"].includes(String(raw.format)) ||
      !["ok", "unsupported", "error", "gone"].includes(String(raw.status)) || !Array.isArray(raw.history) || raw.history.length > 10_000) return malformed();
  let latest: PostRecord["latest"] = null;
  if (raw.latest !== null) {
    if (!object(raw.latest) || !date(raw.latest.at)) return malformed();
    latest = { at: iso(raw.latest.at), metrics: values(raw.latest.metrics) };
  }
  const history: Snapshot[] = raw.history.map((entry: unknown) => {
    if (!object(entry) || !date(entry.at) || typeof entry.date !== "string" || !/^\d{4}-\d\d-\d\d$/.test(entry.date)) return malformed();
    return { date: entry.date, at: iso(entry.at), ...values(entry) };
  });
  if (raw.syncedAt !== undefined && !date(raw.syncedAt)) return malformed();
  return { key, platform: raw.platform, accountId: raw.accountId, postId: raw.postId, itemId: "",
    format: raw.format as PostRecord["format"], title: safeText(raw.title, 500), caption: "",
    publishedAt: iso(raw.publishedAt), status: raw.status as PostRecord["status"], latest, history, misses: 0,
    ...(typeof raw.syncedAt === "string" ? { syncedAt: iso(raw.syncedAt) } : {}) };
}

function parseAccount(key: string, raw: Record<string, unknown>): NonNullable<MarketingAnalyticsSnapshot["accounts"]>[number] {
  if (!platform(raw.platform) || !identifier(raw.accountId) || key !== accountKey(raw.platform, raw.accountId) || raw.key !== key ||
      !["ok", "paused-auth", "rate-limited", "unsupported", "not-connected", "error"].includes(String(raw.status)) || !date(raw.at)) return malformed();
  return { platform: raw.platform, accountId: raw.accountId, label: raw.label === null ? null : safeText(raw.label, 160),
    status: raw.status as AccountSync["status"], at: iso(raw.at) };
}

async function readSaved(): Promise<{ raw: Record<string, unknown>; modifiedAt: string }> {
  const root = await realpath(dataRoot());
  const requested = path.join(root, "analytics", "metrics.json");
  const file = await realpath(requested);
  if (path.relative(requested, file) !== "") throw new StoreError("outside_root");
  const handle = await open(file, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new StoreError("unreadable");
    if (before.size > MAX_BYTES) throw new StoreError("too_large");
    // A writer can grow the file after stat. Bound both individual allocations
    // and actual descriptor bytes, including only one byte beyond the limit.
    const chunks: Buffer[] = [];
    let count = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(Math.min(256 * 1024, MAX_BYTES + 1 - count));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      count += bytesRead;
      if (count > MAX_BYTES) throw new StoreError("too_large");
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    const current = await stat(file);
    const signature = (info: typeof before) => `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    if (signature(before) !== signature(after) || signature(after) !== signature(current) || await realpath(requested) !== file) {
      throw new StoreError("changed");
    }
    let raw: unknown;
    try { raw = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return malformed(); }
    if (!object(raw) || raw.version !== 1 || !object(raw.posts) || !object(raw.accounts) || !object(raw.sync) ||
        Object.keys(raw.posts).length > MAX_ROWS || Object.keys(raw.accounts).length > MAX_ROWS) return malformed();
    return { raw, modifiedAt: before.mtime.toISOString() };
  } finally { await handle.close(); }
}

function totals(rows: PostRow[], days: number, at: Date): NullableTotals[] {
  return platformTotals(rows, days, at).map((total) => {
    const measured = rows.filter((row) => row.platform === total.platform && row.measured &&
      Date.parse(row.publishedAt) >= at.getTime() - days * DAY && Date.parse(row.publishedAt) <= at.getTime());
    const available = (key: "views" | "likes" | "shares" | "saves") => measured.some((row) => row.metrics[key] !== undefined);
    return { ...total, views: available("views") ? total.views : null, likes: available("likes") ? total.likes : null,
      comments: measured.some((row) => row.metrics.comments !== undefined || row.metrics.replies !== undefined) ? total.comments : null,
      shares: available("shares") ? total.shares : null, saves: available("saves") ? total.saves : null,
      engagements: measured.some((row) => row.engagements !== null) ? total.engagements : null };
  });
}

/**
 * Passive saved-metrics reader. Imports only pure original query/types helpers;
 * never imports GET lifecycle, sync, credential, provider or mutable store code.
 */
export function createMarketingAnalyticsReader(config: {
  resolveScope: (authenticatedOwnerId: string) => TrustedAnalyticsScope | null | Promise<TrustedAnalyticsScope | null>;
  now?: () => Date;
}) {
  return {
    async snapshot(ownerId: string, requested: MarketingAnalyticsFilters = {}): Promise<MarketingAnalyticsSnapshot> {
      const query = filters(requested);
      const at = (config.now ?? (() => new Date()))();
      const result: MarketingAnalyticsSnapshot = {
        connection: { state: "unavailable", message: "Saved analytics are unavailable. No sync was requested." },
        snapshot: "persisted_metrics", store: { state: "not_configured", reason: "scope_unavailable" }, generatedAt: at.toISOString(),
        filters: query, accounts: null, posts: null, totals: null, counts: null, freshness: null
      };
      let scope: unknown;
      try { scope = structuredClone(await config.resolveScope(ownerId)); } catch { return result; }
      if (!validScope(scope, ownerId)) return result;
      const permitted = new Set(scope.accounts.filter((entry) => !query.platform || entry.platform === query.platform)
        .map((entry) => accountKey(entry.platform, entry.accountId)));
      if (!permitted.size) return result;
      try {
        const { raw, modifiedAt } = await readSaved();
        const posts: PostRecord[] = [];
        const accounts: NonNullable<MarketingAnalyticsSnapshot["accounts"]> = [];
        for (const [key, entry] of Object.entries(raw.posts as Record<string, unknown>)) {
          // Require explicit recorded identity; never normalize an absent account
          // to a primary account or infer ownership from a linked item/source.
          if (!object(entry) || !platform(entry.platform) || !identifier(entry.accountId)) return malformed();
          if (permitted.has(accountKey(entry.platform, entry.accountId))) posts.push(parsePost(key, entry));
        }
        for (const [key, entry] of Object.entries(raw.accounts as Record<string, unknown>)) {
          if (!object(entry) || !platform(entry.platform) || !identifier(entry.accountId)) return malformed();
          if (permitted.has(accountKey(entry.platform, entry.accountId))) accounts.push(parseAccount(key, entry));
        }
        const rows = posts.map(rowFromRecord);
        const matching = rows.filter((row) => Date.parse(row.publishedAt) >= at.getTime() - query.windowDays * DAY && Date.parse(row.publishedAt) <= at.getTime());
        const selected = sortRows(matching, query.sort).slice(0, query.limit);
        const publicPosts: SavedAnalyticsPost[] = selected.map((row) => ({ key: row.key, platform: row.platform, accountId: row.accountId,
          postId: row.postId, format: row.format, title: row.title, publishedAt: row.publishedAt, status: row.status, measured: row.measured,
          metrics: { ...row.metrics }, engagements: row.engagements, engagementRate: row.engagementRate, syncedAt: row.syncedAt, trend: row.trend }));
        const matchingKeys = new Set(matching.map((row) => row.key));
        const measurements = posts.filter((post) => matchingKeys.has(post.key)).flatMap((post) => post.latest ? [post.latest.at] : []).sort();
        return { ...result, connection: { state: "read_only", message: "Saved metrics only. This snapshot does not refresh accounts or request sync." },
          store: { state: "loaded" }, accounts: accounts.sort((a, b) => accountKey(a.platform, a.accountId).localeCompare(accountKey(b.platform, b.accountId))),
          posts: publicPosts, totals: { window: totals(rows, query.windowDays, at), last7: totals(rows, 7, at), last28: totals(rows, 28, at) },
          counts: { matchingPosts: matching.length, returnedPosts: selected.length, measuredPosts: matching.filter((row) => row.measured).length, truncated: matching.length > selected.length },
          freshness: { storeModifiedAt: modifiedAt, latestMeasurementAt: measurements.at(-1) ?? null, oldestMeasurementAt: measurements[0] ?? null } };
      } catch (error) {
        result.store = (error as NodeJS.ErrnoException).code === "ENOENT" ? { state: "missing" }
          : { state: "unavailable", reason: error instanceof StoreError ? error.reason : "unreadable" };
        return result;
      }
    }
  };
}
