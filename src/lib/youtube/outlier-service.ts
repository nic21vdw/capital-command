import { youtubeAccessToken } from "@/lib/publisher/adapters/youtube";
import { publisherConfig } from "@/lib/publisher/config";
import { fetchJson } from "@/lib/publisher/http";
import {
  computeBaseline,
  detectOutliers,
  mergeOutliers,
  parseChannelInput,
  parseIsoDuration,
  type ChannelRef,
  type OutlierStore,
  type ScanRun,
  type VideoStats,
  type WatchlistChannel
} from "@/lib/youtube/outliers";
import { readOutlierStore, writeOutlierStore } from "@/lib/youtube/outlier-store";

/**
 * YouTube Data API calls for the Outlier Radar. Reuses the existing
 * integration's authenticated client (youtubeAccessToken — the exported,
 * shared token refresher) and the youtube.readonly scope that the OAuth flow
 * already requests; nothing here touches the upload/publishing code paths.
 *
 * Quota: every list call here costs 1 unit (search.list, at 100 units, is
 * deliberately never used — channel URLs/handles resolve via channels.list).
 * A scan costs roughly 2 units per channel (playlistItems.list + videos.list)
 * plus 1 per 50 channels missing an uploads-playlist id, and each run's total
 * is recorded in the run log so quota use is visible.
 */

const API = "https://www.googleapis.com/youtube/v3";

/** Thrown for failures the user can act on; routes map it to a clean response. */
export class OutlierApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export function youtubeConfigured(): boolean {
  const { youtube } = publisherConfig();
  return Boolean(youtube.clientId && youtube.clientSecret && youtube.refreshToken);
}

/** Converts raw fetch failures into user-actionable errors where possible. */
function classifyApiError(error: unknown): OutlierApiError {
  const message = error instanceof Error ? error.message : String(error);
  if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded/i.test(message)) {
    return new OutlierApiError(
      "YouTube API daily quota exceeded (10,000 units/day by default). Quota resets at midnight Pacific Time — try again after the reset.",
      429
    );
  }
  if (/HTTP 403/.test(message)) {
    return new OutlierApiError(
      "YouTube rejected the read (403). The stored connection likely predates the read-only scope — reconnect YouTube from the Uploading Center.",
      403
    );
  }
  if (/HTTP 401/.test(message)) {
    return new OutlierApiError("YouTube authorization failed (401) — reconnect YouTube from the Uploading Center.", 401);
  }
  return new OutlierApiError(message, 502);
}

async function authHeaders(): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await youtubeAccessToken()}` };
}

type ChannelResource = {
  id?: string;
  snippet?: { title?: string; customUrl?: string; thumbnails?: Record<string, { url?: string } | undefined> };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
};

function toWatchlistChannel(resource: ChannelResource, nowIso: string): WatchlistChannel | null {
  if (!resource.id) return null;
  const thumbnails = resource.snippet?.thumbnails ?? {};
  return {
    id: resource.id,
    title: resource.snippet?.title ?? resource.id,
    handle: resource.snippet?.customUrl ?? null,
    thumbnailUrl: thumbnails.default?.url ?? thumbnails.medium?.url ?? null,
    uploadsPlaylistId: resource.contentDetails?.relatedPlaylists?.uploads ?? null,
    addedAt: nowIso,
    lastFetchedAt: null,
    lastError: null,
    baseline: null,
    recentVideos: [],
    group: ""
  };
}

/**
 * Resolves pasted channel input (id, @handle, or URL) to a full channel record
 * via channels.list — 1 unit per attempt. Returns the units actually spent so
 * the caller can log them.
 */
export async function resolveChannel(rawInput: string): Promise<{ channel: WatchlistChannel; unitsUsed: number }> {
  const ref = parseChannelInput(rawInput);
  if (!ref) {
    throw new OutlierApiError(
      "Could not read that as a YouTube channel. Paste a channel URL, an @handle, or a UC… channel id.",
      400
    );
  }
  const headers = await (async () => {
    try {
      return await authHeaders();
    } catch (error) {
      throw classifyApiError(error);
    }
  })();

  // Legacy /c/ custom URLs usually match the handle; fall back to the old
  // username lookup before giving up — both are 1-unit channels.list calls.
  const attempts: ChannelRef[] = ref.kind === "handle" ? [ref, { kind: "user", value: ref.value }] : [ref];
  let unitsUsed = 0;
  for (const attempt of attempts) {
    const param =
      attempt.kind === "id"
        ? `id=${encodeURIComponent(attempt.value)}`
        : attempt.kind === "handle"
          ? `forHandle=${encodeURIComponent(attempt.value)}`
          : `forUsername=${encodeURIComponent(attempt.value)}`;
    unitsUsed += 1;
    let data: { items?: ChannelResource[] };
    try {
      data = await fetchJson<{ items?: ChannelResource[] }>(
        `${API}/channels?part=snippet,contentDetails&${param}`,
        { label: "YouTube channel resolve", method: "GET", headers }
      );
    } catch (error) {
      throw classifyApiError(error);
    }
    const channel = data.items?.[0] ? toWatchlistChannel(data.items[0], new Date().toISOString()) : null;
    if (channel) return { channel, unitsUsed };
  }
  throw new OutlierApiError(
    `No YouTube channel found for "${rawInput.trim()}". Check the URL/handle, or paste the UC… channel id directly.`,
    404
  );
}

type PlaylistItemResource = { contentDetails?: { videoId?: string } };
type VideoResource = {
  id?: string;
  snippet?: { title?: string; publishedAt?: string; thumbnails?: Record<string, { url?: string } | undefined> };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
};

/** Recent uploads with stats: playlistItems.list + videos.list = 2 units. */
async function fetchRecentVideos(
  headers: Record<string, string>,
  uploadsPlaylistId: string,
  count: number
): Promise<{ videos: VideoStats[]; unitsUsed: number }> {
  let unitsUsed = 1;
  const playlist = await fetchJson<{ items?: PlaylistItemResource[] }>(
    `${API}/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(uploadsPlaylistId)}&maxResults=${Math.min(50, count)}`,
    { label: "YouTube uploads playlist", method: "GET", headers }
  );
  const ids = (playlist.items ?? [])
    .map((item) => item.contentDetails?.videoId)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return { videos: [], unitsUsed };

  unitsUsed += 1;
  const details = await fetchJson<{ items?: VideoResource[] }>(
    `${API}/videos?part=snippet,statistics,contentDetails&id=${ids.join(",")}&maxResults=50`,
    { label: "YouTube video stats", method: "GET", headers }
  );
  const videos: VideoStats[] = [];
  for (const resource of details.items ?? []) {
    // Premieres/upcoming videos can lack view counts — skip rather than treat as 0.
    if (!resource.id || !resource.snippet?.publishedAt || resource.statistics?.viewCount === undefined) continue;
    const thumbnails = resource.snippet.thumbnails ?? {};
    videos.push({
      videoId: resource.id,
      title: resource.snippet.title ?? "Untitled video",
      publishedAt: new Date(resource.snippet.publishedAt).toISOString(),
      views: Number(resource.statistics.viewCount) || 0,
      likes: resource.statistics.likeCount !== undefined ? Number(resource.statistics.likeCount) || 0 : null,
      comments: resource.statistics.commentCount !== undefined ? Number(resource.statistics.commentCount) || 0 : null,
      durationSeconds: parseIsoDuration(resource.contentDetails?.duration),
      thumbnailUrl: thumbnails.medium?.url ?? thumbnails.default?.url ?? null
    });
  }
  return { videos, unitsUsed };
}

/** Fills in uploads-playlist ids for channels missing one — 1 unit per 50. */
async function backfillUploadsPlaylists(
  headers: Record<string, string>,
  channels: WatchlistChannel[]
): Promise<number> {
  const missing = channels.filter((channel) => !channel.uploadsPlaylistId);
  let unitsUsed = 0;
  for (let start = 0; start < missing.length; start += 50) {
    const batch = missing.slice(start, start + 50);
    unitsUsed += 1;
    const data = await fetchJson<{ items?: ChannelResource[] }>(
      `${API}/channels?part=contentDetails&id=${batch.map((c) => c.id).join(",")}&maxResults=50`,
      { label: "YouTube uploads playlist lookup", method: "GET", headers }
    );
    for (const resource of data.items ?? []) {
      const uploads = resource.contentDetails?.relatedPlaylists?.uploads;
      const channel = batch.find((c) => c.id === resource.id);
      if (channel && uploads) channel.uploadsPlaylistId = uploads;
    }
  }
  return unitsUsed;
}

let scanInFlight = false;

/**
 * Pulls fresh stats for every watchlist channel, recomputes baselines, flags
 * outliers, and appends a run-log entry. Channels fetched within the cooldown
 * are served from cache (unless force) so repeated clicks don't burn quota.
 * Per-channel failures (e.g. a deleted channel) are recorded on the channel
 * and don't abort the rest of the scan; quota/auth failures abort with a
 * clear message since every remaining call would fail the same way.
 */
export async function runOutlierScan(options: { force?: boolean } = {}): Promise<{ store: OutlierStore; run: ScanRun }> {
  if (!youtubeConfigured()) {
    throw new OutlierApiError(
      "YouTube is not connected. Set YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET and use Connect YouTube in the Uploading Center first.",
      400
    );
  }
  if (scanInFlight) throw new OutlierApiError("A stats pull is already running — wait for it to finish.", 409);
  scanInFlight = true;
  try {
    return await scan(options.force ?? false);
  } finally {
    scanInFlight = false;
  }
}

async function scan(force: boolean): Promise<{ store: OutlierStore; run: ScanRun }> {
  const store = await readOutlierStore();
  const { config } = store;
  const now = new Date();
  const nowIso = now.toISOString();
  const cooldownMs = config.cooldownMinutes * 60 * 1000;

  let unitsUsed = 0;
  let channelsChecked = 0;
  let channelsSkipped = 0;
  let channelsFailed = 0;
  const notes: string[] = [];

  let headers: Record<string, string>;
  try {
    headers = await authHeaders();
  } catch (error) {
    throw classifyApiError(error);
  }

  const channels = store.channels.map((channel) => ({ ...channel }));
  try {
    unitsUsed += await backfillUploadsPlaylists(headers, channels);
  } catch (error) {
    throw classifyApiError(error);
  }

  let freshOutlierCandidates = store.outliers;
  for (const channel of channels) {
    if (!force && channel.lastFetchedAt && now.getTime() - new Date(channel.lastFetchedAt).getTime() < cooldownMs) {
      channelsSkipped += 1;
      continue;
    }
    if (!channel.uploadsPlaylistId) {
      channelsFailed += 1;
      channel.lastError = "Channel has no uploads playlist (it may have been deleted or has no public videos).";
      continue;
    }
    try {
      const { videos, unitsUsed: cost } = await fetchRecentVideos(headers, channel.uploadsPlaylistId, config.baselineWindow);
      unitsUsed += cost;
      const baseline = computeBaseline(videos, config.baselineWindow);
      channel.recentVideos = videos;
      channel.baseline = { ...baseline, computedAt: nowIso };
      channel.lastFetchedAt = nowIso;
      channel.lastError = null;
      channelsChecked += 1;
      const flagged = detectOutliers(channel, videos, baseline, config.multiplier, now);
      freshOutlierCandidates = mergeOutliers(freshOutlierCandidates, flagged);
    } catch (error) {
      const classified = classifyApiError(error);
      // Quota/auth failures apply to every remaining channel — stop burning calls.
      if (classified.status === 429 || classified.status === 403 || classified.status === 401) {
        notes.push(`Scan stopped early: ${classified.message}`);
        channelsFailed += 1;
        channel.lastError = classified.message;
        break;
      }
      channelsFailed += 1;
      channel.lastError = classified.message;
    }
  }

  const newOutliers = freshOutlierCandidates.length - store.outliers.length;
  const run: ScanRun = {
    id: `run-${crypto.randomUUID()}`,
    at: nowIso,
    unitsUsed,
    channelsChecked,
    channelsSkipped,
    channelsFailed,
    newOutliers,
    notes
  };

  const next: OutlierStore = {
    ...store,
    channels,
    outliers: freshOutlierCandidates,
    runs: [run, ...store.runs].slice(0, 30)
  };
  await writeOutlierStore(next);
  return { store: next, run };
}
