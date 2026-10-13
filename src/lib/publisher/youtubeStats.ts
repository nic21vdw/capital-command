import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { primaryAccountId } from "@/lib/publisher/accounts";
import { youtubeAccessToken } from "@/lib/publisher/adapters/youtube";
import { publisherConfig } from "@/lib/publisher/config";
import { isYoutubeReconnectRequired, isYoutubeScopeInsufficient, youtubeRefreshTokenFor } from "@/lib/publisher/googleAuth";
import { fetchJson } from "@/lib/publisher/http";
import {
  STATS_BATCH_SIZE,
  STATS_TTL_MS,
  type YoutubeStat,
  type YoutubeStatsResponse
} from "@/lib/publisher/youtubeStatsShared";

/**
 * Views, likes and comments for the YouTube videos this app posted.
 *
 * Read-only and fail-open. This never publishes, and it can never get in the
 * way of posting: no sign-in, a revoked grant, a quota error or a dead network
 * all end the same way - the last numbers we have, plus a plain reason. Nothing
 * here throws to the screen.
 *
 * A video is re-read at most every 30 minutes (videos.list costs one quota unit
 * per call of up to 50 ids). The numbers live in data/youtube-stats.json, a
 * cache the app owns; deleting it only costs a re-read.
 */

const API = "https://www.googleapis.com/youtube/v3";
/** After a failed read, leave an account alone this long instead of retrying on every poll. */
const FAILURE_BACKOFF_MS = 5 * 60 * 1000;
/** The cache holds the newest this-many videos. */
const MAX_CACHED = 2000;

export type StatsCache = Record<string, YoutubeStat>;
export type StatsRequest = { videoId: string; accountId: string };
export type RawStats = { views: number | null; likes: number | null; comments: number | null };

export type StatsDeps = {
  now: () => Date;
  readCache: () => Promise<StatsCache>;
  writeCache: (cache: StatsCache) => Promise<void>;
  /** Whether this account can be read at all, decided without touching the network. */
  isConnected: (accountId: string) => Promise<boolean>;
  /** One videos.list call (<= 50 ids). Ids YouTube does not return are simply absent. */
  fetchStatistics: (accountId: string, videoIds: string[]) => Promise<Record<string, RawStats>>;
  /** Accounts that failed recently; kept by the caller so tests can stand alone. */
  failures: Map<string, number>;
  ttlMs?: number;
};

/** A read that failed for a reason the person can fix by reconnecting. */
export class StatsNotPermittedError extends Error {}

// ---- pure parts -------------------------------------------------------------

function toCount(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** videos.list returns counts as strings and omits any the owner hides. */
export function parseStatistics(resource: { statistics?: Record<string, unknown> } | undefined): RawStats {
  const statistics = resource?.statistics ?? {};
  return {
    views: toCount(statistics.viewCount),
    likes: toCount(statistics.likeCount),
    comments: toCount(statistics.commentCount)
  };
}

export function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

/** The ids whose cached numbers are missing or older than the TTL. */
export function idsDueForRefresh(ids: string[], cache: StatsCache, now: Date, ttlMs: number = STATS_TTL_MS): string[] {
  return ids.filter((id) => {
    const at = new Date(cache[id]?.fetchedAt ?? "").getTime();
    return Number.isNaN(at) || now.getTime() - at >= ttlMs;
  });
}

/** Fresh reads replace cached ones; everything else is kept, trimmed to the newest MAX_CACHED. */
export function mergeStats(cache: StatsCache, fetched: Record<string, RawStats>, now: Date, max: number = MAX_CACHED): StatsCache {
  const merged: StatsCache = { ...cache };
  for (const [id, raw] of Object.entries(fetched)) merged[id] = { ...raw, fetchedAt: now.toISOString() };
  const entries = Object.entries(merged);
  if (entries.length <= max) return merged;
  entries.sort((a, b) => b[1].fetchedAt.localeCompare(a[1].fetchedAt));
  return Object.fromEntries(entries.slice(0, max));
}

// ---- the read ---------------------------------------------------------------

export async function resolveYoutubeStats(requests: StatsRequest[], deps: StatsDeps): Promise<YoutubeStatsResponse> {
  const now = deps.now();
  const ttl = deps.ttlMs ?? STATS_TTL_MS;
  const accountOf = new Map<string, string>();
  for (const request of requests) if (!accountOf.has(request.videoId)) accountOf.set(request.videoId, request.accountId);
  const ids = [...accountOf.keys()];

  let cache: StatsCache = {};
  try {
    cache = await deps.readCache();
  } catch {
    cache = {};
  }

  const due = idsDueForRefresh(ids, cache, now, ttl);
  const byAccount = new Map<string, string[]>();
  for (const id of due) {
    const account = accountOf.get(id)!;
    byAccount.set(account, [...(byAccount.get(account) ?? []), id]);
  }

  let fetched: Record<string, RawStats> = {};
  let notConnected = false;
  let failure: string | null = null;
  for (const [accountId, accountIds] of byAccount) {
    const failedAt = deps.failures.get(accountId);
    if (failedAt !== undefined && now.getTime() - failedAt < FAILURE_BACKOFF_MS) {
      failure = failure ?? "YouTube could not be reached a moment ago, so these numbers may be out of date.";
      continue;
    }
    let connected = false;
    try {
      connected = await deps.isConnected(accountId);
    } catch {
      connected = false;
    }
    if (!connected) {
      notConnected = true;
      continue;
    }
    try {
      for (const batch of chunk(accountIds, STATS_BATCH_SIZE)) {
        fetched = { ...fetched, ...(await deps.fetchStatistics(accountId, batch)) };
      }
      deps.failures.delete(accountId);
    } catch (error) {
      if (error instanceof StatsNotPermittedError) {
        notConnected = true;
        continue;
      }
      deps.failures.set(accountId, now.getTime());
      failure = failure ?? "YouTube could not be read right now, so these numbers may be out of date.";
    }
  }

  if (Object.keys(fetched).length > 0) {
    cache = mergeStats(cache, fetched, now);
    try {
      await deps.writeCache(cache);
    } catch {
      // A cache that cannot be saved is still a correct answer for this request.
    }
  }

  const stats: Record<string, YoutubeStat> = {};
  for (const id of ids) if (cache[id]) stats[id] = cache[id];
  let status: YoutubeStatsResponse["status"] = "ok";
  let message: string | null = null;
  if (failure) {
    status = Object.keys(stats).length > 0 ? "stale" : "error";
    message = failure;
  } else if (notConnected) {
    status = "not-connected";
    message = "YouTube is not connected for reading numbers. Connect YouTube in Settings to see views here.";
  }
  return { status, message, stats, items: {} };
}

// ---- real dependencies ------------------------------------------------------

const CACHE_FILE = () => dataPath("youtube-stats.json");
let writeChain: Promise<void> = Promise.resolve();
const failures = new Map<string, number>();

async function readCacheFile(): Promise<StatsCache> {
  try {
    const parsed = JSON.parse(await readFile(CACHE_FILE(), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: StatsCache = {};
    for (const [id, value] of Object.entries(parsed as Record<string, Partial<YoutubeStat>>)) {
      if (!value || typeof value.fetchedAt !== "string") continue;
      out[id] = {
        views: toCount(value.views),
        likes: toCount(value.likes),
        comments: toCount(value.comments),
        fetchedAt: value.fetchedAt
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeCacheFile(cache: StatsCache): Promise<void> {
  // Serialized so two overlapping reads cannot interleave a write; each write
  // re-reads the file and keeps the newer entry per video.
  const next = writeChain.then(async () => {
    const onDisk = await readCacheFile();
    const merged: StatsCache = { ...onDisk };
    for (const [id, stat] of Object.entries(cache)) {
      if (!merged[id] || merged[id].fetchedAt <= stat.fetchedAt) merged[id] = stat;
    }
    const target = CACHE_FILE();
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(merged, null, 2), "utf8");
    await rename(temp, target);
  });
  writeChain = next.catch(() => {});
  return next;
}

async function accountIsConnected(accountId: string): Promise<boolean> {
  const { youtube } = publisherConfig();
  if (!youtube.clientId || !youtube.clientSecret) return false;
  return Boolean(await youtubeRefreshTokenFor(accountId));
}

async function fetchStatisticsFromYoutube(accountId: string, videoIds: string[]): Promise<Record<string, RawStats>> {
  try {
    const token = await youtubeAccessToken(accountId);
    const response = await fetchJson<{ items?: Array<{ id?: string; statistics?: Record<string, unknown> }> }>(
      `${API}/videos?part=statistics&id=${videoIds.map(encodeURIComponent).join(",")}&maxResults=${STATS_BATCH_SIZE}`,
      { label: "YouTube video statistics", method: "GET", headers: { Authorization: `Bearer ${token}` } }
    );
    const out: Record<string, RawStats> = {};
    for (const item of response.items ?? []) if (item.id) out[item.id] = parseStatistics(item);
    return out;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A grant minted before youtube.readonly was added 403s until reconnected.
    if (isYoutubeScopeInsufficient(error) || isYoutubeReconnectRequired(error) || /HTTP 403/.test(message)) {
      throw new StatsNotPermittedError(message);
    }
    throw error;
  }
}

export const liveStatsDeps: StatsDeps = {
  now: () => new Date(),
  readCache: readCacheFile,
  writeCache: writeCacheFile,
  isConnected: accountIsConnected,
  fetchStatistics: fetchStatisticsFromYoutube,
  failures
};

/** The primary YouTube account, for a request that names only video ids. */
export function defaultYoutubeAccount(): string {
  return primaryAccountId("youtube");
}
