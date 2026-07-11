import { z } from "zod";

/**
 * Outlier Radar core: watch a list of *other* channels, baseline each one on
 * the median views of its recent uploads, and flag videos performing at or
 * above a configurable multiple of that baseline.
 *
 * This module is pure (no I/O) so the math and merging rules are unit-testable.
 * Persistence lives in outlier-store.ts and the YouTube Data API calls in
 * outlier-service.ts — deliberately separate from the publishing adapter so
 * the frozen OAuth/upload code is never touched.
 */

// ----- Stored shapes (data/youtube-outliers.json) -----

export const videoStatsSchema = z.object({
  videoId: z.string(),
  title: z.string().default(""),
  publishedAt: z.string(),
  views: z.coerce.number().min(0),
  likes: z.coerce.number().min(0).nullable().default(null),
  comments: z.coerce.number().min(0).nullable().default(null),
  thumbnailUrl: z.string().nullable().default(null)
});

export const channelBaselineSchema = z.object({
  medianViews: z.coerce.number().min(0),
  sampleSize: z.coerce.number().int().min(0),
  computedAt: z.string()
});

export const watchlistChannelSchema = z.object({
  /** Canonical channel id (UC…). */
  id: z.string(),
  title: z.string().default(""),
  handle: z.string().nullable().default(null),
  thumbnailUrl: z.string().nullable().default(null),
  /** The channel's uploads playlist — resolved once, then reused every run. */
  uploadsPlaylistId: z.string().nullable().default(null),
  addedAt: z.string(),
  lastFetchedAt: z.string().nullable().default(null),
  /** Last per-channel scan failure, shown in the UI instead of failing the whole run. */
  lastError: z.string().nullable().default(null),
  baseline: channelBaselineSchema.nullable().default(null),
  /** Cached stats from the last pull so reloads don't cost quota. */
  recentVideos: z.array(videoStatsSchema).default([])
});

export const outlierSchema = z.object({
  videoId: z.string(),
  channelId: z.string(),
  channelTitle: z.string().default(""),
  title: z.string().default(""),
  url: z.string(),
  thumbnailUrl: z.string().nullable().default(null),
  views: z.coerce.number().min(0),
  baselineViews: z.coerce.number().min(0),
  /** views / channel baseline at the most recent scan that saw this video. */
  multiplier: z.coerce.number().min(0),
  publishedAt: z.string(),
  detectedAt: z.string(),
  lastSeenAt: z.string(),
  /** Free-text manual tag (hook style, topic, format…). No ML — notes only. */
  tag: z.string().default("")
});

export const scanRunSchema = z.object({
  id: z.string(),
  at: z.string(),
  /** Estimated YouTube Data API units this run consumed (1 unit per list call). */
  unitsUsed: z.coerce.number().int().min(0),
  channelsChecked: z.coerce.number().int().min(0),
  channelsSkipped: z.coerce.number().int().min(0),
  channelsFailed: z.coerce.number().int().min(0),
  newOutliers: z.coerce.number().int().min(0),
  notes: z.array(z.string()).default([])
});

export const outlierConfigSchema = z.object({
  /** Flag videos at or above this multiple of the channel baseline. */
  multiplier: z.coerce.number().min(1).default(3),
  /** How many recent uploads feed the rolling median. */
  baselineWindow: z.coerce.number().int().min(3).max(50).default(10),
  /** Channels fetched more recently than this are served from cache. */
  cooldownMinutes: z.coerce.number().int().min(0).default(60)
});

export const outlierStoreSchema = z.object({
  channels: z.array(watchlistChannelSchema).default([]),
  outliers: z.array(outlierSchema).default([]),
  runs: z.array(scanRunSchema).default([]),
  config: outlierConfigSchema.default({ multiplier: 3, baselineWindow: 10, cooldownMinutes: 60 })
});

export type VideoStats = z.infer<typeof videoStatsSchema>;
export type WatchlistChannel = z.infer<typeof watchlistChannelSchema>;
export type Outlier = z.infer<typeof outlierSchema>;
export type ScanRun = z.infer<typeof scanRunSchema>;
export type OutlierConfig = z.infer<typeof outlierConfigSchema>;
export type OutlierStore = z.infer<typeof outlierStoreSchema>;

export const defaultOutlierStore: OutlierStore = outlierStoreSchema.parse({});

// ----- Channel input parsing -----

export type ChannelRef =
  | { kind: "id"; value: string }
  | { kind: "handle"; value: string }
  | { kind: "user"; value: string };

const CHANNEL_ID_RE = /^UC[0-9A-Za-z_-]{22}$/;
// Handles are 3-30 chars of letters, digits, underscores, hyphens and periods.
const HANDLE_RE = /^[A-Za-z0-9_.-]{3,30}$/;

/**
 * Accepts the ways people paste a channel — a raw UC… id, an @handle, or any
 * common channel URL (/channel/UC…, /@handle, /user/name, /c/name) — and
 * normalizes it to something channels.list can resolve. Legacy /c/ custom
 * URLs have no cheap lookup (search.list costs 100 units), so they are tried
 * as a handle, which matches for most channels. Returns null for input that
 * is not recognizably a channel.
 */
export function parseChannelInput(raw: string): ChannelRef | null {
  const input = raw.trim();
  if (!input) return null;
  if (CHANNEL_ID_RE.test(input)) return { kind: "id", value: input };
  if (input.startsWith("@")) {
    const handle = input.slice(1);
    return HANDLE_RE.test(handle) ? { kind: "handle", value: handle } : null;
  }

  let url: URL | null = null;
  try {
    url = new URL(input.includes("://") ? input : `https://${input}`);
  } catch {
    url = null;
  }
  const host = url?.hostname.replace(/^(www|m)\./, "");
  if (url && (host === "youtube.com" || host?.endsWith(".youtube.com"))) {
    const segments = url.pathname.split("/").filter(Boolean);
    const first = segments[0] ?? "";
    if (first === "channel" && segments[1] && CHANNEL_ID_RE.test(segments[1])) {
      return { kind: "id", value: segments[1] };
    }
    if (first.startsWith("@")) {
      const handle = decodeURIComponent(first.slice(1));
      return HANDLE_RE.test(handle) ? { kind: "handle", value: handle } : null;
    }
    if (first === "user" && segments[1]) return { kind: "user", value: decodeURIComponent(segments[1]) };
    if (first === "c" && segments[1]) {
      const slug = decodeURIComponent(segments[1]);
      return HANDLE_RE.test(slug) ? { kind: "handle", value: slug } : null;
    }
    return null;
  }

  // Bare text that isn't a URL: treat it as a handle typed without the @.
  if (!input.includes("/") && HANDLE_RE.test(input)) return { kind: "handle", value: input };
  return null;
}

// ----- Baseline + flagging -----

/** Median views over the newest `window` videos. Zero when nothing to sample. */
export function computeBaseline(videos: VideoStats[], window: number): { medianViews: number; sampleSize: number } {
  const sample = [...videos]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, window)
    .map((v) => v.views)
    .sort((a, b) => a - b);
  if (sample.length === 0) return { medianViews: 0, sampleSize: 0 };
  const mid = Math.floor(sample.length / 2);
  const median = sample.length % 2 === 1 ? sample[mid] : (sample[mid - 1] + sample[mid]) / 2;
  return { medianViews: median, sampleSize: sample.length };
}

/** A baseline needs a few videos before "3x the median" means anything. */
export const MIN_BASELINE_SAMPLE = 3;

/**
 * Flags videos at or above `multiplier` × the channel's median views. Returns
 * fresh Outlier records stamped with `now`; merging with previously stored
 * outliers (to preserve tags and first-detected dates) happens in mergeOutliers.
 */
export function detectOutliers(
  channel: Pick<WatchlistChannel, "id" | "title">,
  videos: VideoStats[],
  baseline: { medianViews: number; sampleSize: number },
  multiplier: number,
  now: Date
): Outlier[] {
  if (baseline.sampleSize < MIN_BASELINE_SAMPLE || baseline.medianViews <= 0) return [];
  const nowIso = now.toISOString();
  return videos
    .filter((video) => video.views >= baseline.medianViews * multiplier)
    .map((video) => ({
      videoId: video.videoId,
      channelId: channel.id,
      channelTitle: channel.title,
      title: video.title,
      url: `https://www.youtube.com/watch?v=${video.videoId}`,
      thumbnailUrl: video.thumbnailUrl,
      views: video.views,
      baselineViews: baseline.medianViews,
      multiplier: baseline.medianViews > 0 ? Number((video.views / baseline.medianViews).toFixed(2)) : 0,
      publishedAt: video.publishedAt,
      detectedAt: nowIso,
      lastSeenAt: nowIso,
      tag: ""
    }));
}

/**
 * Merges freshly detected outliers into the stored list. Re-detected videos
 * keep their original detectedAt and manual tag but pick up current stats;
 * previously flagged videos that no longer clear the bar are kept — they were
 * real detections and may carry the user's notes.
 */
export function mergeOutliers(existing: Outlier[], fresh: Outlier[]): Outlier[] {
  const byId = new Map(existing.map((outlier) => [outlier.videoId, outlier]));
  for (const found of fresh) {
    const prior = byId.get(found.videoId);
    byId.set(
      found.videoId,
      prior ? { ...found, detectedAt: prior.detectedAt, tag: prior.tag } : found
    );
  }
  return [...byId.values()];
}
