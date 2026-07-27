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
  /** Video length in seconds; null for stats stored before durations were pulled. */
  durationSeconds: z.coerce.number().min(0).nullable().default(null),
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
  recentVideos: z.array(videoStatsSchema).default([]),
  /**
   * Free-text group label ("" = unlabeled). Labeling channels — e.g.
   * "Competition" — lets the competition panel analyze them together without
   * changing anything about how unlabeled channels are scanned.
   */
  group: z.string().default("")
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
  /** Engagement + length from the last scan; null for pre-existing detections. */
  likes: z.coerce.number().min(0).nullable().default(null),
  comments: z.coerce.number().min(0).nullable().default(null),
  durationSeconds: z.coerce.number().min(0).nullable().default(null),
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

/** A saved AI competition analysis — the text is the expensive part, so it persists. */
export const competitorInsightSchema = z.object({
  id: z.string(),
  /** The group label the analysis covered; null = every labeled channel. */
  group: z.string().nullable().default(null),
  generatedAt: z.string(),
  model: z.string().default(""),
  insights: z.string(),
  outlierCount: z.coerce.number().int().min(0).default(0),
  channelCount: z.coerce.number().int().min(0).default(0)
});

export const outlierStoreSchema = z.object({
  channels: z.array(watchlistChannelSchema).default([]),
  outliers: z.array(outlierSchema).default([]),
  runs: z.array(scanRunSchema).default([]),
  config: outlierConfigSchema.default({ multiplier: 3, baselineWindow: 10, cooldownMinutes: 60 }),
  competitorInsights: z.array(competitorInsightSchema).default([])
});

export type CompetitorInsight = z.infer<typeof competitorInsightSchema>;
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
      likes: video.likes,
      comments: video.comments,
      durationSeconds: video.durationSeconds,
      publishedAt: video.publishedAt,
      detectedAt: nowIso,
      lastSeenAt: nowIso,
      tag: ""
    }));
}

// ----- Durations -----

/**
 * Parses the ISO 8601 durations videos.list returns ("PT1M30S", "P1DT2H").
 * Returns whole seconds, or null for unparseable/zero durations (live
 * streams report "P0D" while they have no fixed length).
 */
export function parseIsoDuration(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  const total =
    Number(days ?? 0) * 86_400 + Number(hours ?? 0) * 3_600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0);
  return total > 0 ? total : null;
}

/** "0:45", "12:34", "1:02:03" — the familiar YouTube length format. */
export function formatDurationSeconds(total: number): string {
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
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

// ----- Per-video insight breakdown -----

/** Shorts can run up to 3 minutes; anything at or under this reads as a Short. */
export const SHORT_MAX_SECONDS = 180;

export type OutlierInsights = {
  /** "short" (≤3 min) vs long-form; null when the duration is unknown. */
  format: "short" | "long" | null;
  durationSeconds: number | null;
  channelMedianDurationSeconds: number | null;
  /** Average views per day between publish and the last stats pull. */
  viewsPerDay: number | null;
  /** likes / views (0-1). */
  likeRate: number | null;
  channelMedianLikeRate: number | null;
  /** CPR — comments per 1,000 views. */
  cpr: number | null;
  channelMedianCpr: number | null;
  whatWorked: string[];
  watchouts: string[];
  missingData: string[];
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const compact = (value: number) =>
  Intl.NumberFormat("en", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
const percent = (rate: number) => `${(rate * 100).toFixed(1)}%`;

/**
 * Turns one flagged outlier plus its channel's cached recent uploads into a
 * readable breakdown: length vs the channel norm, velocity, like rate, and
 * CPR (comments per 1,000 views), with generated "what worked / what to
 * check" notes. Heuristics over public stats only — CTR and retention are
 * private to the channel owner and deliberately never guessed at as numbers.
 */
export function buildOutlierInsights(outlier: Outlier, channel: WatchlistChannel | null | undefined): OutlierInsights {
  // Peers = the channel's other recent uploads; the outlier itself would skew its own norm.
  const peers = (channel?.recentVideos ?? []).filter((v) => v.videoId !== outlier.videoId);
  const channelMedianDurationSeconds = median(
    peers.map((v) => v.durationSeconds).filter((d): d is number => d !== null && d > 0)
  );
  const channelMedianLikeRate = median(
    peers.filter((v) => v.likes !== null && v.views > 0).map((v) => (v.likes as number) / v.views)
  );
  const channelMedianCpr = median(
    peers.filter((v) => v.comments !== null && v.views > 0).map((v) => ((v.comments as number) / v.views) * 1000)
  );

  const durationSeconds = outlier.durationSeconds;
  const format = durationSeconds === null ? null : durationSeconds <= SHORT_MAX_SECONDS ? "short" : "long";

  const elapsedMs = new Date(outlier.lastSeenAt).getTime() - new Date(outlier.publishedAt).getTime();
  const viewsPerDay = Number.isFinite(elapsedMs)
    ? Math.round(outlier.views / Math.max(1, elapsedMs / 86_400_000))
    : null;

  const likeRate = outlier.likes !== null && outlier.views > 0 ? outlier.likes / outlier.views : null;
  const cpr = outlier.comments !== null && outlier.views > 0 ? (outlier.comments / outlier.views) * 1000 : null;

  const whatWorked: string[] = [];
  const watchouts: string[] = [];
  const missingData: string[] = [];

  whatWorked.push(
    `${compact(outlier.views)} views against a ${compact(outlier.baselineViews)}-view baseline — ${outlier.multiplier.toFixed(1)}× the channel's typical recent upload.`
  );
  if (viewsPerDay !== null) {
    whatWorked.push(`Averaging ~${compact(viewsPerDay)} views/day since publish (as of the last stats pull).`);
  }

  if (durationSeconds !== null) {
    const fmt = formatDurationSeconds(durationSeconds);
    if (format === "short" && channelMedianDurationSeconds !== null && channelMedianDurationSeconds > SHORT_MAX_SECONDS) {
      whatWorked.push(
        `It's a Short (${fmt}) on a channel that usually posts ~${formatDurationSeconds(channelMedianDurationSeconds)} videos — the Shorts feed likely drove the extra reach.`
      );
    } else if (channelMedianDurationSeconds !== null && durationSeconds <= channelMedianDurationSeconds * 0.6) {
      whatWorked.push(
        `Noticeably shorter than the channel's typical upload (${fmt} vs ~${formatDurationSeconds(channelMedianDurationSeconds)}) — a tighter edit tends to hold retention.`
      );
    } else if (channelMedianDurationSeconds !== null && durationSeconds >= channelMedianDurationSeconds * 1.6) {
      whatWorked.push(
        `Much longer than the channel's typical upload (${fmt} vs ~${formatDurationSeconds(channelMedianDurationSeconds)}) — the topic earned extra watch time, which feeds recommendations.`
      );
    }
  } else {
    missingData.push("Duration is missing for this video — run Force refresh to re-pull stats with video lengths.");
  }

  if (likeRate !== null && channelMedianLikeRate !== null && channelMedianLikeRate > 0) {
    if (likeRate >= channelMedianLikeRate * 1.15) {
      whatWorked.push(
        `Like rate ${percent(likeRate)} beats the channel's typical ${percent(channelMedianLikeRate)} — the content delivered on the click, not just the packaging.`
      );
    } else if (likeRate <= channelMedianLikeRate * 0.75) {
      watchouts.push(
        `Like rate ${percent(likeRate)} is below the channel's typical ${percent(channelMedianLikeRate)} — the title/thumbnail pulled clicks the content didn't fully pay off.`
      );
    }
  } else if (likeRate === null) {
    missingData.push("Likes are hidden or missing for this video, so like rate can't be compared.");
  }

  if (cpr !== null && channelMedianCpr !== null && channelMedianCpr > 0) {
    if (cpr >= channelMedianCpr * 1.5) {
      whatWorked.push(
        `CPR ${cpr.toFixed(1)} comments/1k views vs the channel's typical ${channelMedianCpr.toFixed(1)} — it sparked real conversation; read the comments for the angle that hit.`
      );
    } else if (cpr <= channelMedianCpr * 0.5) {
      watchouts.push(
        `CPR ${cpr.toFixed(1)} comments/1k views vs the channel's typical ${channelMedianCpr.toFixed(1)} — big reach but little discussion; the audience it reached may be broader than the channel's core.`
      );
    }
  } else if (cpr === null) {
    missingData.push("Comments are disabled or missing for this video, so CPR can't be compared.");
  }

  const titleSignals: string[] = [];
  if (outlier.title.includes("?")) titleSignals.push("a question hook");
  if (/\bhow\b/i.test(outlier.title)) titleSignals.push("a how-to promise");
  if (/\d/.test(outlier.title)) titleSignals.push("a concrete number");
  if (/#\w/.test(outlier.title)) titleSignals.push("hashtags riding topic feeds");
  if (titleSignals.length > 0) {
    whatWorked.push(`The title leans on ${titleSignals.join(", ")} — packaging patterns worth testing on your own uploads.`);
  }

  if (watchouts.length === 0 && (likeRate !== null || cpr !== null)) {
    watchouts.push("Nothing negative stands out in the public stats — engagement is in line with the reach.");
  }

  return {
    format,
    durationSeconds,
    channelMedianDurationSeconds,
    viewsPerDay,
    likeRate,
    channelMedianLikeRate,
    cpr,
    channelMedianCpr,
    whatWorked,
    watchouts,
    missingData
  };
}
