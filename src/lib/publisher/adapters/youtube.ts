import { readFile, stat } from "node:fs/promises";
import { publisherConfig } from "@/lib/publisher/config";
import { PermanentError, fetchJson, fetchRaw } from "@/lib/publisher/http";
import { bareTags, composeDescription } from "@/lib/publisher/metadata";
import { formatInTimezone, toRfc3339Utc } from "@/lib/publisher/time";
import type { PlatformAdapter, PlatformState, PostResult, PublishInput, PublishPlan, QueueItem } from "@/lib/publisher/types";

/**
 * YouTube Data API v3 — the one platform with native scheduling.
 *
 * The video is uploaded as privacyStatus "private" with status.publishAt set
 * to the target RFC3339 time; YouTube flips it public at that moment on its
 * own, so the schedule holds even if our runner never wakes again. Uploads
 * use the resumable protocol (videos.insert, uploadType=resumable). As a
 * safety net, finalize() runs after the slot time and forces the video
 * public if YouTube did not flip it (some API projects have publishAt
 * silently ignored until they pass Google's audit).
 *
 * Quota: each upload costs ~1600 units of the default 10,000/day, so roughly
 * six uploads/day before requesting a quota increase.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/** Shared by the upload adapter and the channel-schedule reader. */
export async function youtubeAccessToken(): Promise<string> {
  const { youtube } = publisherConfig();
  if (!youtube.clientId || !youtube.clientSecret || !youtube.refreshToken) {
    throw new PermanentError(
      "YouTube is not configured. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET, then use Connect YouTube in the Uploading Center (or set YOUTUBE_REFRESH_TOKEN)."
    );
  }
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.accessToken;
  const data = await fetchJson<{ access_token: string; expires_in: number }>(TOKEN_URL, {
    label: "YouTube token refresh",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: youtube.clientId,
      client_secret: youtube.clientSecret,
      refresh_token: youtube.refreshToken,
      grant_type: "refresh_token"
    })
  });
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.accessToken;
}

type YoutubeBody = {
  snippet: { title: string; description: string; tags?: string[]; categoryId?: string };
  status: { privacyStatus: string; publishAt?: string; selfDeclaredMadeForKids: boolean };
};

function buildBody(input: PublishInput): { body: YoutubeBody; scheduled: boolean } {
  const config = publisherConfig();
  const { item } = input;
  const publishAt = new Date(item.publishAt);
  // publishAt is only honored on videos uploaded as "private", and only makes
  // sense when the end state is public and the time is still in the future.
  const scheduled = item.visibility === "public" && publishAt.getTime() > Date.now();
  const body: YoutubeBody = {
    snippet: {
      title: item.title.slice(0, 100),
      description: composeDescription(item).slice(0, 5000),
      ...(bareTags(item).length > 0 ? { tags: bareTags(item) } : {}),
      ...(config.youtube.categoryId ? { categoryId: config.youtube.categoryId } : {})
    },
    status: {
      privacyStatus: scheduled ? "private" : item.visibility,
      ...(scheduled ? { publishAt: toRfc3339Utc(publishAt) } : {}),
      selfDeclaredMadeForKids: false
    }
  };
  return { body, scheduled };
}

/**
 * Renames a video that is already on the channel (scheduled or published).
 * videos.update with part=snippet replaces the whole snippet, so the current
 * one is read first and resent with only the title changed — categoryId is
 * required on snippet updates and must be preserved. Works under the existing
 * youtube.upload scope for videos this app uploaded.
 */
export async function updateYoutubeVideoTitle(videoId: string, title: string): Promise<void> {
  const token = await youtubeAccessToken();
  const current = await fetchJson<{ items?: Array<{ snippet?: Record<string, unknown> }> }>(
    `${VIDEOS_URL}?part=snippet&id=${encodeURIComponent(videoId)}`,
    { label: "YouTube video snippet read", method: "GET", headers: { Authorization: `Bearer ${token}` } }
  );
  const snippet = current.items?.[0]?.snippet;
  if (!snippet) {
    throw new PermanentError(`YouTube video ${videoId} was not found — it may have been deleted from the channel.`);
  }
  await fetchJson(`${VIDEOS_URL}?part=snippet`, {
    label: "YouTube title update",
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ id: videoId, snippet: { ...snippet, title: title.slice(0, 100) } })
  });
}

export const youtubeAdapter: PlatformAdapter = {
  id: "youtube",

  configured(): boolean {
    const { youtube } = publisherConfig();
    return Boolean(youtube.clientId && youtube.clientSecret && youtube.refreshToken);
  },

  async validateAuth(): Promise<void> {
    await youtubeAccessToken();
  },

  buildPlan(input: PublishInput): PublishPlan {
    const config = publisherConfig();
    const { body, scheduled } = buildBody(input);
    const publishAt = new Date(input.item.publishAt);
    return {
      platform: "youtube",
      endpoint: UPLOAD_URL,
      payload: { ...body },
      publishAtUtc: toRfc3339Utc(publishAt),
      publishAtLocal: formatInTimezone(publishAt, config.timezone),
      notes: [
        scheduled
          ? "Uploads as private with status.publishAt — YouTube publishes it natively at the target time."
          : `Uploads directly as ${body.status.privacyStatus} (no future public time to schedule).`,
        "Upload costs ~1600 quota units of the 10,000/day default."
      ]
    };
  },

  async publish(input: PublishInput): Promise<PostResult> {
    const token = await youtubeAccessToken();
    const { body, scheduled } = buildBody(input);
    const media = await readFile(input.localPath);
    const size = (await stat(input.localPath)).size;

    // Step 1: open a resumable session; the video's metadata goes here.
    const init = await fetchRaw(UPLOAD_URL, {
      label: "YouTube resumable init",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(size)
      },
      body: JSON.stringify(body)
    });
    const sessionUrl = init.headers.get("location");
    if (!sessionUrl) throw new PermanentError("YouTube resumable init returned no session Location header.");

    // Step 2: send the bytes. Clips are small, so a single PUT is fine — on a
    // dropped connection the whole platform attempt retries with backoff.
    const upload = await fetchJson<{ id?: string }>(sessionUrl, {
      label: "YouTube video upload",
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "video/mp4",
        "Content-Length": String(size)
      },
      body: media
    });
    if (!upload.id) throw new PermanentError("YouTube upload finished but returned no video id.");
    return {
      status: scheduled ? "scheduled" : "published",
      postId: upload.id,
      detail: scheduled
        ? `scheduled via status.publishAt=${toRfc3339Utc(new Date(input.item.publishAt))}`
        : `uploaded as ${body.status.privacyStatus}`
    };
  },

  /**
   * Called by the runner once a scheduled post's slot time has passed.
   * YouTube normally flips the video public itself via status.publishAt, but
   * that is not guaranteed (notably, API projects that haven't completed
   * Google's audit get uploads locked private and publishAt is ignored) — so
   * verify, and force privacyStatus "public" with videos.update if needed.
   */
  async finalize(item: QueueItem, state: PlatformState): Promise<PostResult> {
    if (!state.postId) {
      throw new PermanentError(`YouTube post for ${item.clipPath} has no video id recorded — cannot verify it went public.`);
    }
    const token = await youtubeAccessToken();
    const current = await fetchJson<{ items?: Array<{ status?: Record<string, unknown> }> }>(
      `${VIDEOS_URL}?part=status&id=${encodeURIComponent(state.postId)}`,
      { label: "YouTube video status check", method: "GET", headers: { Authorization: `Bearer ${token}` } }
    );
    const status = current.items?.[0]?.status;
    if (!status) {
      throw new PermanentError(`YouTube video ${state.postId} was not found — it may have been deleted from the channel.`);
    }
    if (status.privacyStatus === "public") {
      return { status: "published", postId: state.postId, detail: "went public on schedule (YouTube honored status.publishAt)" };
    }
    // Keep the rest of the status part intact; drop publishAt (it has passed
    // and must not be resent with a non-private video) and set it public.
    const nextStatus: Record<string, unknown> = { ...status, privacyStatus: "public" };
    delete nextStatus.publishAt;
    await fetchJson(`${VIDEOS_URL}?part=status`, {
      label: "YouTube privacy update",
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ id: state.postId, status: nextStatus })
    });
    return {
      status: "published",
      postId: state.postId,
      detail: "YouTube left the video private past its slot time — set it public via videos.update"
    };
  }
};
