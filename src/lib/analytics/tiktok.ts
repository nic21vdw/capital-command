import { requestJson, type HttpDeps } from "@/lib/analytics/http";
import { addNote, newOutcome, stopFromError, type FetchOutcome } from "@/lib/analytics/outcome";
import type { MetricValues } from "@/lib/analytics/types";
import { chunk } from "@/lib/publisher/youtubeStats";

export const TIKTOK_BATCH_SIZE = 20;

const QUERY_URL = "https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count";

export const TIKTOK_SCOPE_NOTE =
  "TikTok only returns view and like counts to apps granted the video.list scope. This app asks for video.publish and video.upload only, so TikTok posts are not measured.";

export type TiktokSupport = { supported: true } | { supported: false; reason: string };

export function tiktokSupport(grantedScopes: string): TiktokSupport {
  const scopes = grantedScopes.split(/[,\s]+/).filter(Boolean);
  return scopes.includes("video.list") ? { supported: true } : { supported: false, reason: TIKTOK_SCOPE_NOTE };
}

export function isTiktokVideoId(value: string): boolean {
  return /^\d{8,}$/.test(value);
}

export function parseTiktokVideos(body: unknown): Map<string, MetricValues> {
  const out = new Map<string, MetricValues>();
  const videos = (body as { data?: { videos?: Array<Record<string, unknown>> } } | null)?.data?.videos;
  if (!Array.isArray(videos)) return out;
  for (const video of videos) {
    const id = video?.id;
    if (typeof id !== "string" && typeof id !== "number") continue;
    const metrics: MetricValues = {};
    const fields: Array<[string, keyof MetricValues]> = [
      ["view_count", "views"],
      ["like_count", "likes"],
      ["comment_count", "comments"],
      ["share_count", "shares"]
    ];
    for (const [field, key] of fields) {
      const value = video[field];
      if (typeof value === "number" && Number.isFinite(value)) metrics[key] = value;
    }
    out.set(String(id), metrics);
  }
  return out;
}

export async function fetchTiktokMetrics(session: { token: string }, videoIds: string[], deps: HttpDeps = {}): Promise<FetchOutcome> {
  const outcome = newOutcome();

  for (const batch of chunk(videoIds, TIKTOK_BATCH_SIZE)) {
    let found: Map<string, MetricValues>;
    try {
      found = parseTiktokVideos(
        await requestJson(
          QUERY_URL,
          {
            label: "TikTok video query",
            method: "POST",
            headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json; charset=UTF-8" },
            body: JSON.stringify({ filters: { video_ids: batch } })
          },
          deps
        )
      );
    } catch (error) {
      const stop = stopFromError(error);
      if (stop) {
        outcome.stopped = stop;
        if (stop.kind === "scope") addNote(outcome, TIKTOK_SCOPE_NOTE);
        break;
      }
      for (const id of batch) outcome.failed.push({ postId: id, message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    for (const id of batch) {
      const metrics = found.get(id);
      if (metrics) outcome.results.set(id, { source: "tiktok-video-query", metrics });
      else outcome.gone.push(id);
    }
  }

  return outcome;
}
