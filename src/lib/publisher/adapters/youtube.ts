import { readFile, stat } from "node:fs/promises";
import { publisherConfig } from "@/lib/publisher/config";
import { PermanentError, fetchJson, fetchRaw } from "@/lib/publisher/http";
import { bareTags, composeDescription } from "@/lib/publisher/metadata";
import { formatInTimezone, toRfc3339Utc } from "@/lib/publisher/time";
import type { PlatformAdapter, PostResult, PublishInput, PublishPlan } from "@/lib/publisher/types";

/**
 * YouTube Data API v3 — the one platform with native scheduling.
 *
 * The video is uploaded as privacyStatus "private" with status.publishAt set
 * to the target RFC3339 time; YouTube flips it public at that moment on its
 * own, so the schedule holds even if our runner never wakes again. Uploads
 * use the resumable protocol (videos.insert, uploadType=resumable).
 *
 * Quota: each upload costs ~1600 units of the default 10,000/day, so roughly
 * six uploads/day before requesting a quota increase.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

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
  }
};
