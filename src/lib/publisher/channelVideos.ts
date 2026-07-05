import { youtubeAccessToken } from "@/lib/publisher/adapters/youtube";
import { publisherConfig } from "@/lib/publisher/config";
import { fetchJson } from "@/lib/publisher/http";

/**
 * Reads the channel's own uploads from the YouTube Data API so the Uploading
 * Center can show the real YouTube schedule — including videos scheduled or
 * published outside this app. A read costs 3 quota units (channels.list +
 * playlistItems.list + videos.list) and the result is cached for 5 minutes,
 * so the UI's 60-second poll barely touches the 10,000/day budget.
 */

const API = "https://www.googleapis.com/youtube/v3";
const CACHE_TTL_MS = 5 * 60 * 1000;
/** Public videos older than this are history, not schedule — leave them out. */
const PUBLISHED_LOOKBACK_DAYS = 30;
/** Newest uploads only; one playlist page covers a 50-video window. */
const MAX_VIDEOS = 50;

export type ChannelVideoStatus = "scheduled" | "published";

export type ChannelVideo = {
  videoId: string;
  title: string;
  /** "scheduled" = private upload with a future status.publishAt; "published" = live. */
  status: ChannelVideoStatus;
  /** The instant that places the video on the schedule (go-live time for
   * scheduled videos, actual publish time for published ones), UTC ISO-8601. */
  publishAtUtc: string;
  thumbnailUrl: string | null;
  url: string;
};

export type ChannelSchedule = {
  /** False when YouTube credentials are missing — nothing to read. */
  configured: boolean;
  /** True when the stored token predates the readonly scope; reconnecting fixes it. */
  needsReconnect: boolean;
  /** When the data was last actually read from YouTube. */
  fetchedAt: string | null;
  videos: ChannelVideo[];
  error: string | null;
};

type VideoResource = {
  id: string;
  snippet?: {
    title?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url?: string } | undefined>;
  };
  status?: { privacyStatus?: string; publishAt?: string };
};

let cache: { at: number; schedule: ChannelSchedule } | null = null;

export async function youtubeChannelSchedule(options: { force?: boolean; now?: Date } = {}): Promise<ChannelSchedule> {
  const now = options.now ?? new Date();
  const { youtube } = publisherConfig();
  if (!youtube.clientId || !youtube.clientSecret || !youtube.refreshToken) {
    return { configured: false, needsReconnect: false, fetchedAt: null, videos: [], error: null };
  }
  if (!options.force && cache && now.getTime() - cache.at < CACHE_TTL_MS) return cache.schedule;

  let schedule: ChannelSchedule;
  try {
    const videos = await fetchChannelVideos(now);
    schedule = { configured: true, needsReconnect: false, fetchedAt: now.toISOString(), videos, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/HTTP 403/.test(message)) {
      // The refresh token was minted with only youtube.upload (before the
      // readonly scope was added) — reads 403 until the user reconnects.
      schedule = { configured: true, needsReconnect: true, fetchedAt: now.toISOString(), videos: [], error: null };
    } else {
      // Transient failure: keep the last good data visible and don't cache
      // the error, so the next poll retries immediately.
      return {
        configured: true,
        needsReconnect: false,
        fetchedAt: cache?.schedule.fetchedAt ?? null,
        videos: cache?.schedule.videos ?? [],
        error: message
      };
    }
  }
  cache = { at: now.getTime(), schedule };
  return schedule;
}

async function fetchChannelVideos(now: Date): Promise<ChannelVideo[]> {
  const token = await youtubeAccessToken();
  const auth = { Authorization: `Bearer ${token}` };

  const channels = await fetchJson<{
    items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
  }>(`${API}/channels?part=contentDetails&mine=true`, {
    label: "YouTube channel lookup",
    method: "GET",
    headers: auth
  });
  const uploadsPlaylist = channels.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylist) return [];

  const playlist = await fetchJson<{ items?: Array<{ contentDetails?: { videoId?: string } }> }>(
    `${API}/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(uploadsPlaylist)}&maxResults=${MAX_VIDEOS}`,
    { label: "YouTube uploads playlist", method: "GET", headers: auth }
  );
  const ids = (playlist.items ?? [])
    .map((item) => item.contentDetails?.videoId)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];

  const details = await fetchJson<{ items?: VideoResource[] }>(
    `${API}/videos?part=snippet,status&id=${ids.join(",")}&maxResults=${MAX_VIDEOS}`,
    { label: "YouTube video details", method: "GET", headers: auth }
  );

  const cutoffMs = now.getTime() - PUBLISHED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const videos: ChannelVideo[] = [];
  for (const resource of details.items ?? []) {
    const video = toChannelVideo(resource, cutoffMs);
    if (video) videos.push(video);
  }
  videos.sort((a, b) => a.publishAtUtc.localeCompare(b.publishAtUtc));
  return videos;
}

function toChannelVideo(resource: VideoResource, publishedCutoffMs: number): ChannelVideo | null {
  const thumbnails = resource.snippet?.thumbnails ?? {};
  const base = {
    videoId: resource.id,
    title: resource.snippet?.title ?? "Untitled video",
    thumbnailUrl: thumbnails.medium?.url ?? thumbnails.default?.url ?? null,
    url: `https://www.youtube.com/watch?v=${resource.id}`
  };
  // A private upload carrying status.publishAt is YouTube's own "scheduled"
  // state (exactly what our adapter creates, and what YouTube Studio creates).
  if (resource.status?.privacyStatus === "private" && resource.status.publishAt) {
    return { ...base, status: "scheduled", publishAtUtc: new Date(resource.status.publishAt).toISOString() };
  }
  if (resource.status?.privacyStatus === "public" && resource.snippet?.publishedAt) {
    const publishedAt = new Date(resource.snippet.publishedAt);
    if (publishedAt.getTime() < publishedCutoffMs) return null;
    return { ...base, status: "published", publishAtUtc: publishedAt.toISOString() };
  }
  // Plain private/unlisted uploads have no place on a publish schedule.
  return null;
}
