import { primaryAccountId } from "@/lib/publisher/accounts";
import { youtubeAccessToken } from "@/lib/publisher/adapters/youtube";
import { publisherConfig } from "@/lib/publisher/config";
import { youtubeRefreshTokenFor } from "@/lib/publisher/googleAuth";
import { fetchJson } from "@/lib/publisher/http";
import { parseIso8601Duration } from "@/lib/ingest/classify";
import type { ChannelUpload } from "@/lib/ingest/types";

/**
 * Reads the channel's recent uploads for the daily ingest scan.
 *
 * Deliberately separate from `publisher/channelVideos.ts`, which answers a
 * different question (what is on the publish schedule) and drops everything
 * that is not scheduled-or-recently-public. This one needs the opposite: every
 * recent upload, plus duration and live-stream details so a Short can be told
 * from a stream VOD. Same three reads, same 3 quota units — once a day against
 * a 10,000/day budget.
 */

const API = "https://www.googleapis.com/youtube/v3";
/** One playlist page. Comfortably more than a day of uploads. */
const MAX_VIDEOS = 50;

export type ChannelScan = {
  /** False when YouTube credentials are missing — nothing to read. */
  configured: boolean;
  /** True when the stored token predates the readonly scope; reconnecting fixes it. */
  needsReconnect: boolean;
  channelId: string | null;
  uploads: ChannelUpload[];
};

type VideoResource = {
  id: string;
  snippet?: { title?: string; publishedAt?: string };
  status?: { privacyStatus?: string };
  contentDetails?: { duration?: string };
  liveStreamingDetails?: Record<string, unknown>;
  player?: { embedHtml?: string; embedWidth?: number; embedHeight?: number };
};

/**
 * The Data API exposes no aspect-ratio field for a video. `fileDetails` has real
 * pixel dimensions but is owner-only and 403s the *whole* request when the token
 * is not the owner's, which would take the scan down with it — not worth the
 * risk for one field.
 *
 * The embed player is the usable signal instead: asking for `part=player` with a
 * fixed `maxWidth` makes YouTube compute the matching height for the video's own
 * aspect ratio, so a 9:16 Short comes back much taller than it is wide.
 *
 * Returns null when the shape cannot be read, and the caller treats that as
 * unknown rather than guessing — see decideUpload.
 */
export function aspectFromPlayer(player: VideoResource["player"]): { width: number; height: number } | null {
  if (player?.embedWidth && player?.embedHeight) {
    return { width: player.embedWidth, height: player.embedHeight };
  }
  const html = player?.embedHtml;
  if (!html) return null;
  const width = /width="(\d+)"/.exec(html)?.[1];
  const height = /height="(\d+)"/.exec(html)?.[1];
  if (!width || !height) return null;
  const parsed = { width: Number(width), height: Number(height) };
  if (!parsed.width || !parsed.height) return null;
  return parsed;
}

function toUpload(resource: VideoResource): ChannelUpload | null {
  if (!resource.id) return null;
  return {
    videoId: resource.id,
    title: resource.snippet?.title ?? "Untitled video",
    publishedAt: resource.snippet?.publishedAt
      ? new Date(resource.snippet.publishedAt).toISOString()
      : new Date(0).toISOString(),
    durationSec: parseIso8601Duration(resource.contentDetails?.duration),
    aspect: aspectFromPlayer(resource.player),
    // Presence of the object at all is the signal; a plain upload has no such
    // field. Streams keep it after they end, which is what we want — the VOD is
    // what gets ingested, hours after the stream itself finished.
    wasLiveStream: Boolean(resource.liveStreamingDetails),
    privacyStatus: resource.status?.privacyStatus ?? "unknown",
    url: `https://www.youtube.com/watch?v=${resource.id}`
  };
}

/** A daily scan needs a couple of days of slack for a missed run. */
export const DEFAULT_LOOKBACK_DAYS = 7;

/**
 * @param options.lookbackDays only uploads published within this window are
 *   returned. A daily scan needs a couple of days of slack for a missed run.
 */
export async function scanChannelUploads(
  options: { now?: Date; accountId?: string; lookbackDays?: number } = {}
): Promise<ChannelScan> {
  const now = options.now ?? new Date();
  const lookbackDays = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const accountId = options.accountId ?? primaryAccountId("youtube");
  const { youtube } = publisherConfig();
  const refreshToken = await youtubeRefreshTokenFor(accountId);
  if (!youtube.clientId || !youtube.clientSecret || !refreshToken) {
    return { configured: false, needsReconnect: false, channelId: null, uploads: [] };
  }

  const token = await youtubeAccessToken(accountId);
  const auth = { Authorization: `Bearer ${token}` };

  let channelId: string | null = null;
  try {
    const channels = await fetchJson<{
      items?: Array<{ id?: string; contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
    }>(`${API}/channels?part=id,contentDetails&mine=true`, {
      label: "YouTube channel lookup",
      method: "GET",
      headers: auth
    });
    channelId = channels.items?.[0]?.id ?? null;
    const uploadsPlaylist = channels.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylist) return { configured: true, needsReconnect: false, channelId, uploads: [] };

    const playlist = await fetchJson<{ items?: Array<{ contentDetails?: { videoId?: string } }> }>(
      `${API}/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(uploadsPlaylist)}&maxResults=${MAX_VIDEOS}`,
      { label: "YouTube uploads playlist", method: "GET", headers: auth }
    );
    const ids = (playlist.items ?? [])
      .map((item) => item.contentDetails?.videoId)
      .filter((id): id is string => Boolean(id));
    if (ids.length === 0) return { configured: true, needsReconnect: false, channelId, uploads: [] };

    // maxWidth makes YouTube return embedHeight for the video's real aspect —
    // the only aspect signal available without owner-only fileDetails.
    const details = await fetchJson<{ items?: VideoResource[] }>(
      `${API}/videos?part=snippet,status,contentDetails,liveStreamingDetails,player&id=${ids.join(",")}` +
        `&maxWidth=480&maxResults=${MAX_VIDEOS}`,
      { label: "YouTube video details", method: "GET", headers: auth }
    );

    const cutoffMs = now.getTime() - lookbackDays * 86_400_000;
    const uploads: ChannelUpload[] = [];
    for (const resource of details.items ?? []) {
      const upload = toUpload(resource);
      if (!upload) continue;
      if (new Date(upload.publishedAt).getTime() < cutoffMs) continue;
      uploads.push(upload);
    }
    // Oldest first: if several streams landed, they enter the pipeline in the
    // order they were published.
    uploads.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    return { configured: true, needsReconnect: false, channelId, uploads };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/HTTP 403/.test(message)) {
      // Token minted before the readonly scope was added — reads 403 until the
      // user reconnects. Same condition channelVideos.ts reports.
      return { configured: true, needsReconnect: true, channelId, uploads: [] };
    }
    throw error;
  }
}
