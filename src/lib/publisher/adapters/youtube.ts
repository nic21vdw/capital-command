import { readFile, stat } from "node:fs/promises";
import { primaryAccountId } from "@/lib/publisher/accounts";
import { publisherConfig } from "@/lib/publisher/config";
import {
  isYoutubeReconnectRequired,
  isYoutubeScopeInsufficient,
  youtubeRefreshTokenFor,
  YOUTUBE_RECONNECT_FOR_SCOPE,
  YOUTUBE_RECONNECT_REQUIRED
} from "@/lib/publisher/googleAuth";
import { PermanentError, TransientError, fetchJson, fetchRaw } from "@/lib/publisher/http";
import { IMAGE_REFUSALS, isImagePost } from "@/lib/publisher/images";
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

const cachedTokens = new Map<string, { accessToken: string; expiresAt: number }>();

/**
 * Shared by the upload adapter and the channel-schedule reader. Each account
 * refreshes with its own stored refresh token (the primary account's comes
 * from .env or the original Connect YouTube flow) and caches its own access
 * token.
 */
export async function youtubeAccessToken(accountId: string = primaryAccountId("youtube")): Promise<string> {
  const { youtube } = publisherConfig();
  const refreshToken = await youtubeRefreshTokenFor(accountId);
  if (!youtube.clientId || !youtube.clientSecret || !refreshToken) {
    throw new PermanentError(
      "This YouTube account is not connected. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET, then use Connect YouTube in the Uploading Center (or set YOUTUBE_REFRESH_TOKEN for the primary account)."
    );
  }
  const cached = cachedTokens.get(accountId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;
  try {
    const data = await fetchJson<{ access_token: string; expires_in: number }>(TOKEN_URL, {
      label: "YouTube token refresh",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: youtube.clientId,
        client_secret: youtube.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token"
      })
    });
    cachedTokens.set(accountId, { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
    return data.access_token;
  } catch (error) {
    if (isYoutubeReconnectRequired(error)) {
      cachedTokens.delete(accountId);
      // A revoked grant cannot recover through backoff. Record a permanent,
      // user-safe reason so the UI asks for one reconnect instead of exposing
      // Google's raw invalid_grant JSON or promising a retry that cannot work.
      throw new PermanentError(YOUTUBE_RECONNECT_REQUIRED);
    }
    throw error;
  }
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
export async function updateYoutubeVideoTitle(videoId: string, title: string, accountId?: string): Promise<void> {
  const token = await youtubeAccessToken(accountId);
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

/**
 * Called by the runner once a scheduled post's slot time has passed, and by
 * publish() when the item already carries a video id.
 * YouTube normally flips the video public itself via status.publishAt, but
 * that is not guaranteed (notably, API projects that haven't completed
 * Google's audit get uploads locked private and publishAt is ignored) — so
 * verify, and force privacyStatus "public" with videos.update if needed.
 */
async function finalizeYoutube(item: QueueItem, state: PlatformState): Promise<PostResult> {
  if (!state.postId) {
    throw new PermanentError(`YouTube post for ${item.clipPath} has no video id recorded — cannot verify it went public.`);
  }
  const token = await youtubeAccessToken(item.accountId);
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
  // Reached from publish() on a retry, this can run BEFORE the slot: the video
  // is sitting private with its publishAt ahead of it, exactly as intended, and
  // forcing it public here would post it early.
  if (new Date(item.publishAt).getTime() > Date.now()) {
    return { status: "scheduled", postId: state.postId, detail: "already uploaded and waiting for its slot on YouTube" };
  }
  // Keep the rest of the status part intact; drop publishAt (it has passed
  // and must not be resent with a non-private video) and set it public.
  const nextStatus: Record<string, unknown> = { ...status, privacyStatus: "public" };
  delete nextStatus.publishAt;
  try {
    await fetchJson(`${VIDEOS_URL}?part=status`, {
      label: "YouTube privacy update",
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ id: state.postId, status: nextStatus })
    });
  } catch (error) {
    if (isYoutubeScopeInsufficient(error)) throw new PermanentError(YOUTUBE_RECONNECT_FOR_SCOPE);
    throw error;
  }
  return {
    status: "published",
    postId: state.postId,
    detail: "YouTube left the video private past its slot time — set it public via videos.update"
  };
}

type SessionState = {
  /** The upload already completed and YouTube handed back this video. */
  videoId?: string;
  /** The session is alive and has this many bytes; undefined means it is gone. */
  receivedBytes?: number;
};

/**
 * Asks an existing resumable session what it received, using the zero-length
 * "PUT with Content-Range: bytes * /<size>" query the protocol defines.
 *
 *  - 200/201 → the bytes all arrived and the video exists; the body is the
 *    video resource, so the id can be adopted without uploading anything.
 *  - 308 → the session is open and partially filled; Range gives the offset.
 *  - 404/410 → the session expired (they last a week) and produced no video.
 *
 * Any other status is left to the caller's normal error handling.
 */
async function adoptResumableSession(sessionUrl: string, token: string, size: number): Promise<SessionState> {
  let response: Response;
  try {
    response = await fetch(sessionUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Range": `bytes */${size}` }
    });
  } catch (error) {
    throw new TransientError(
      `YouTube resumable session query network error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (response.status === 404 || response.status === 410) return {};
  if (response.status === 308) {
    // "bytes=0-524287" — the last byte received. No Range header at all means
    // the session exists but has nothing in it yet.
    const range = response.headers.get("range");
    const end = range ? Number(range.split("-")[1]) : NaN;
    return { receivedBytes: Number.isFinite(end) ? end + 1 : 0 };
  }
  if (response.ok) {
    const text = await response.text().catch(() => "");
    let id: string | undefined;
    try {
      id = (JSON.parse(text) as { id?: string }).id;
    } catch {
      id = undefined;
    }
    if (!id) {
      throw new PermanentError(
        `YouTube reported the resumable upload complete but returned no video id: ${text.slice(0, 200)}`
      );
    }
    return { videoId: id };
  }
  const text = await response.text().catch(() => "");
  throw response.status === 408 || response.status === 429 || response.status >= 500
    ? new TransientError(`YouTube resumable session query failed (HTTP ${response.status}): ${text.slice(0, 500)}`)
    : new PermanentError(`YouTube resumable session query failed (HTTP ${response.status}): ${text.slice(0, 500)}`);
}

/** Sends the remaining bytes of a resumable session and returns the video id. */
async function sendResumableBytes(
  sessionUrl: string,
  token: string,
  media: Buffer,
  size: number,
  from: number
): Promise<string> {
  const remaining = from > 0 ? media.subarray(from) : media;
  const upload = await fetchJson<{ id?: string }>(sessionUrl, {
    label: "YouTube video upload",
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "video/mp4",
      "Content-Length": String(remaining.length),
      ...(from > 0 ? { "Content-Range": `bytes ${from}-${size - 1}/${size}` } : {})
    },
    body: remaining
  });
  if (!upload.id) throw new PermanentError("YouTube upload finished but returned no video id.");
  return upload.id;
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
    if (isImagePost(input.item)) throw new PermanentError(IMAGE_REFUSALS.youtube!);
    const state = input.item.platforms.youtube;
    // The video is already on the channel — a retry that re-uploaded here would
    // leave two copies of the same clip. Finish that one instead.
    if (state?.postId) return finalizeYoutube(input.item, state);
    // Everything up to here is safe to repeat: reading config, refreshing the
    // token and loading the file put nothing on the channel. A failure in this
    // stretch (the "token refresh network error" kind) can retry freely.
    const token = await youtubeAccessToken(input.item.accountId);
    const { body, scheduled } = buildBody(input);
    const media = await readFile(input.localPath);
    const size = (await stat(input.localPath)).size;
    const describe = (id: string): PostResult => ({
      status: scheduled ? "scheduled" : "published",
      postId: id,
      detail: scheduled
        ? `scheduled via status.publishAt=${toRfc3339Utc(new Date(input.item.publishAt))}`
        : `uploaded as ${body.status.privacyStatus}`
    });

    // A session URL left over from a previous attempt means bytes may already
    // have reached YouTube. Ask that session what it got before assuming
    // nothing did — this is the difference between resuming one upload and
    // publishing the same clip twice.
    const existing = state?.containerId;
    if (existing) {
      const resumed = await adoptResumableSession(existing, token, size);
      if (resumed.videoId) return describe(resumed.videoId);
      if (resumed.receivedBytes !== undefined) {
        const id = await sendResumableBytes(existing, token, media, size, resumed.receivedBytes);
        return describe(id);
      }
      // The session is gone (expired or unknown). Falling through starts a new
      // one, which is safe: an expired session never produced a video.
    }

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
    // Record the session BEFORE any bytes move. If the upload lands but the
    // response never gets back to us, this is what stops the next run from
    // creating a second video.
    await input.onHandle?.(sessionUrl);

    // Step 2: send the bytes. Clips are small, so a single PUT is fine.
    const id = await sendResumableBytes(sessionUrl, token, media, size, 0);
    return describe(id);
  },

  finalize: finalizeYoutube
};
