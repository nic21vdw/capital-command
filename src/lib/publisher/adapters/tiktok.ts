import { open, stat } from "node:fs/promises";
import { publisherConfig } from "@/lib/publisher/config";
import { PermanentError, StillProcessingError, ThrottledError, fetchJson, fetchRaw } from "@/lib/publisher/http";
import { IMAGE_REFUSALS, isImagePost } from "@/lib/publisher/images";
import { composeCaption } from "@/lib/publisher/metadata";
import { consentProblem, fetchCreatorPostingInfo, reconcileWithCreator } from "@/lib/publisher/tiktokPost";
import { getCachedToken, setCachedToken } from "@/lib/publisher/tokens";
import { formatInTimezone, toRfc3339Utc } from "@/lib/publisher/time";
import type { PlatformAdapter, PostResult, PublishInput, PublishPlan } from "@/lib/publisher/types";

/**
 * TikTok Content Posting API (Direct Post).
 *
 * No native scheduling exists, so the runner calls this at the target time.
 *
 * Audit gate. TikTok refuses Direct Post from an unaudited client outright
 * unless the target account is itself private —
 * "unaudited_client_can_only_post_to_private_accounts" — so forcing
 * SELF_ONLY is not enough to make posting work before approval.
 *
 * So a post carrying no consent (item.tiktok) uses the INBOX flow: the clip is
 * sent to the creator's TikTok INBOX and they finish the post from the
 * notification in the TikTok mobile app. Nothing is posted publicly by the
 * API, which is why TikTok allows it for an unaudited client on a public
 * account, and the creator makes every privacy and interaction choice inside
 * TikTok — the reason the inbox flow needs no consent panel of its own.
 *
 * A post whose creator filled in the consent panel (delivery "direct") is
 * direct posted with exactly what they chose, after creator_info is queried
 * again to confirm those answers still hold. Before approval TikTok restricts
 * direct posts to private viewing, so an unaudited direct post may only ask
 * for SELF_ONLY; after approval every audience creator_info offers is open.
 *
 * Primary source is FILE_UPLOAD (direct binary upload — no hosting needed);
 * PULL_FROM_URL is available via TIKTOK_UPLOAD_MODE=url and requires the
 * hosting bucket plus a URL prefix/domain verified in the TikTok developer
 * portal.
 */

const API_BASE = "https://open.tiktokapis.com/v2";
const REFRESH_TOKEN_CACHE_KEY = "tiktok.refreshToken";
const POLL_INTERVAL_MS = 10_000;
const MAX_POLLS_PER_RUN = 24;

// FILE_UPLOAD chunking rules: each chunk must be 5 MB – 64 MB, and the final
// chunk may absorb the trailing remainder (up to 128 MB). Whole files under
// 64 MB upload as a single chunk — the common case for a short clip.
// VERIFY: exact merge rules for the final chunk are described in the official
// media-transfer guide: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
const SINGLE_CHUNK_MAX = 64 * 1024 * 1024;
const CHUNK_SIZE = 32 * 1024 * 1024;

type TiktokEnvelope<T> = { data?: T; error?: { code?: string; message?: string } };

/**
 * Refusals that mean "not now" rather than "not ever". TikTok returns them as
 * HTTP 400, which the shared classifier reads as a caller mistake and the
 * runner then records as a permanent failure — so a clip that TikTok would
 * have taken the next morning was being thrown away instead. Each maps to how
 * long the wall actually stands for.
 *
 * spam_risk_too_many_pending_share is the one that fires here: the inbox flow
 * leaves every clip waiting for a tap in the TikTok app, and TikTok stops
 * accepting new ones long before the creator clears the backlog.
 */
const THROTTLE_MINUTES: Record<string, number> = {
  spam_risk_too_many_pending_share: 360,
  spam_risk_too_many_posts: 720,
  rate_limit_exceeded: 60,
  reached_active_user_cap: 60
};

const THROTTLE_ADVICE: Record<string, string> = {
  spam_risk_too_many_pending_share:
    "TikTok is holding as many unfinished uploads as it will — open the TikTok app and post or discard the clips waiting in your inbox.",
  spam_risk_too_many_posts: "TikTok's posting limit for the day is spent.",
  rate_limit_exceeded: "TikTok is rate limiting this app.",
  reached_active_user_cap: "TikTok's daily cap for this app is spent."
};

/** A ThrottledError if the refusal was one that time clears, else null. */
function throttleFor(text: string, label: string): ThrottledError | null {
  for (const [code, minutes] of Object.entries(THROTTLE_MINUTES)) {
    if (!text.includes(code)) continue;
    const hours = minutes / 60;
    return new ThrottledError(
      minutes,
      `${label} refused: ${THROTTLE_ADVICE[code]} Trying again in ${hours} hour${hours === 1 ? "" : "s"} — the clip keeps its place.`
    );
  }
  return null;
}

function assertOk<T>(payload: TiktokEnvelope<T>, label: string): T {
  const code = payload.error?.code;
  if (code && code !== "ok") {
    const throttled = throttleFor(code, label);
    if (throttled) throw throttled;
    throw new PermanentError(`${label} returned error ${code}: ${payload.error?.message ?? ""}`);
  }
  if (!payload.data) throw new PermanentError(`${label} returned no data.`);
  return payload.data;
}

let cachedAccess: { accessToken: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  const { tiktok } = publisherConfig();
  if (!tiktok.clientKey || !tiktok.clientSecret || !tiktok.refreshToken) {
    throw new PermanentError("TikTok is not configured. Set TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET and TIKTOK_REFRESH_TOKEN.");
  }
  if (cachedAccess && cachedAccess.expiresAt > Date.now() + 60_000) return cachedAccess.accessToken;

  // TikTok may rotate the refresh token — prefer the persisted rotation over
  // the .env seed, and store any new value the response carries.
  const refreshToken = (await getCachedToken(REFRESH_TOKEN_CACHE_KEY)) ?? tiktok.refreshToken;
  const data = await fetchJson<{
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  }>(`${API_BASE}/oauth/token/`, {
    label: "TikTok token refresh",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: tiktok.clientKey,
      client_secret: tiktok.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });
  if (!data.access_token) {
    throw new PermanentError(`TikTok token refresh failed: ${data.error ?? ""} ${data.error_description ?? ""}`.trim());
  }
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    await setCachedToken(REFRESH_TOKEN_CACHE_KEY, data.refresh_token);
  }
  cachedAccess = { accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cachedAccess.accessToken;
}

/**
 * The audience for a direct post: the creator's own answer when they gave one,
 * otherwise the item's visibility, which is how a post scheduled before the
 * consent panel existed still resolves. Never public while unaudited — TikTok
 * refuses that outright.
 */
function privacyLevel(input: PublishInput): string {
  const { tiktok } = publisherConfig();
  const chosen = input.item.tiktok?.privacyLevel;
  if (chosen) return chosen;
  if (!tiktok.audited) return "SELF_ONLY";
  return input.item.visibility === "public" ? "PUBLIC_TO_EVERYONE" : "SELF_ONLY";
}

function chunkPlan(size: number): { chunkSize: number; totalChunkCount: number } {
  if (size <= SINGLE_CHUNK_MAX) return { chunkSize: size, totalChunkCount: 1 };
  return { chunkSize: CHUNK_SIZE, totalChunkCount: Math.floor(size / CHUNK_SIZE) };
}

function uploadMode(): "file" | "url" {
  return process.env.TIKTOK_UPLOAD_MODE?.trim().toLowerCase() === "url" ? "url" : "file";
}

/**
 * Which flow this post takes. Direct posting is a choice the creator makes in
 * the consent panel; anything without that consent goes to the inbox, which is
 * where every post went before the panel existed.
 */
function inboxFlow(input: PublishInput): boolean {
  return (input.item.tiktok?.delivery ?? "inbox") !== "direct";
}

function initEndpoint(input: PublishInput): string {
  return inboxFlow(input) ? `${API_BASE}/post/publish/inbox/video/init/` : `${API_BASE}/post/publish/video/init/`;
}

type SourceInfo =
  | { source: "FILE_UPLOAD"; video_size: number; chunk_size: number; total_chunk_count: number }
  | { source: "PULL_FROM_URL"; video_url: string };

type InitBody = {
  /**
   * Only Direct Post carries post_info — the inbox flow has no title or
   * privacy of its own, because the creator writes those in the TikTok app
   * before they publish. Sending it there is rejected.
   */
  post_info?: {
    title: string;
    privacy_level: string;
    disable_duet: boolean;
    disable_comment: boolean;
    disable_stitch: boolean;
    /** The commercial-content disclosure, as the creator declared it. */
    brand_content_toggle: boolean;
    brand_organic_toggle: boolean;
  };
  source_info: SourceInfo;
};

function buildInitBody(input: PublishInput, size: number): InitBody {
  const caption = composeCaption(input.item).slice(0, 2200);
  const consent = input.item.tiktok;
  const post_info = inboxFlow(input)
    ? undefined
    : {
        // TikTok has no separate description field; hashtags go in the title text.
        title: caption,
        privacy_level: privacyLevel(input),
        // Off unless the creator turned it on themselves. TikTok's guidelines
        // are explicit that none of these may start checked, so a missing
        // answer is a no and never a default yes.
        disable_duet: consent?.allowDuet !== true,
        disable_comment: consent?.allowComment !== true,
        disable_stitch: consent?.allowStitch !== true,
        brand_content_toggle: consent?.brandedContent === true,
        brand_organic_toggle: consent?.brandOrganic === true
      };
  if (uploadMode() === "url") {
    if (!input.publicUrl) {
      throw new PermanentError("TIKTOK_UPLOAD_MODE=url needs hosted media — configure the S3_* variables, or switch back to file mode.");
    }
    // VERIFY: PULL_FROM_URL requires the URL prefix or domain to be verified
    // in the TikTok developer portal before TikTok will fetch from it.
    return { post_info, source_info: { source: "PULL_FROM_URL", video_url: input.publicUrl } };
  }
  const { chunkSize, totalChunkCount } = chunkPlan(size);
  return {
    post_info,
    source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: totalChunkCount }
  };
}

async function uploadChunks(uploadUrl: string, localPath: string, size: number): Promise<void> {
  const { chunkSize, totalChunkCount } = chunkPlan(size);
  const handle = await open(localPath, "r");
  try {
    for (let chunk = 0; chunk < totalChunkCount; chunk += 1) {
      const start = chunk * chunkSize;
      // The final chunk absorbs the remainder of the file.
      const end = chunk === totalChunkCount - 1 ? size : start + chunkSize;
      const buffer = Buffer.alloc(end - start);
      await handle.read(buffer, 0, buffer.length, start);
      await fetchRaw(uploadUrl, {
        label: `TikTok chunk upload ${chunk + 1}/${totalChunkCount}`,
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(buffer.length),
          "Content-Range": `bytes ${start}-${end - 1}/${size}`
        },
        body: buffer
      });
    }
  } finally {
    await handle.close();
  }
}

async function pollStatus(publishId: string, token: string): Promise<PostResult> {
  for (let poll = 0; poll < MAX_POLLS_PER_RUN; poll += 1) {
    const payload = await fetchJson<TiktokEnvelope<{ status?: string; publicaly_available_post_id?: number[]; fail_reason?: string }>>(
      `${API_BASE}/post/publish/status/fetch/`,
      {
        label: "TikTok status fetch",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ publish_id: publishId })
      }
    );
    const data = assertOk(payload, "TikTok status fetch");
    // Inbox flow: TikTok has the clip and it is waiting in the creator's
    // drafts. Nothing else happens over the API — the last step is a tap in
    // the TikTok app — so this is terminal, not something to keep polling.
    if (data.status === "SEND_TO_USER_INBOX") {
      return {
        status: "scheduled",
        containerId: publishId,
        detail: "Sent to your TikTok inbox — open the TikTok app on your phone and tap the notification to finish the post."
      };
    }
    if (data.status === "PUBLISH_COMPLETE") {
      // VERIFY: the post id field is spelled "publicaly_available_post_id" in
      // the official status-fetch reference (sic).
      const postId = data.publicaly_available_post_id?.[0];
      return {
        status: "published",
        postId: postId ? String(postId) : publishId,
        containerId: publishId,
        detail: "PUBLISH_COMPLETE"
      };
    }
    if (data.status === "FAILED") {
      throw new PermanentError(`TikTok publish failed: ${data.fail_reason ?? "unknown reason"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new StillProcessingError(publishId, "TikTok is still processing the upload — will resume on the next run.");
}

/**
 * Re-reads the creator's TikTok settings and holds the stored consent against
 * them. An answer the account no longer permits is dropped rather than sent,
 * and an audience TikTok no longer offers stops the post here instead of
 * letting it go out as something the creator did not choose.
 */
async function withCurrentCreatorSettings(input: PublishInput, token: string): Promise<PublishInput> {
  const info = await fetchCreatorPostingInfo(token);
  const consent = reconcileWithCreator(input.item.tiktok ?? { delivery: "direct" }, info);
  const problem = consentProblem(consent, info);
  if (problem) throw new PermanentError("TikTok will not take this post as scheduled: " + problem);
  if (!publisherConfig().tiktok.audited && consent.privacyLevel !== "SELF_ONLY") {
    throw new PermanentError(
      "TikTok restricts an unaudited app to private posts, and this one asks for a wider audience. Send it to the inbox instead, or wait for the app review."
    );
  }
  return { ...input, item: { ...input.item, tiktok: consent } };
}

export const tiktokAdapter: PlatformAdapter = {
  id: "tiktok",

  configured(): boolean {
    const { tiktok } = publisherConfig();
    return Boolean(tiktok.clientKey && tiktok.clientSecret && tiktok.refreshToken);
  },

  async validateAuth(): Promise<void> {
    await accessToken();
  },

  buildPlan(input: PublishInput): PublishPlan {
    const config = publisherConfig();
    const publishAt = new Date(input.item.publishAt);
    const body = buildInitBody(input, 0);
    return {
      platform: "tiktok",
      endpoint: initEndpoint(input),
      payload: { ...body },
      publishAtUtc: toRfc3339Utc(publishAt),
      publishAtLocal: formatInTimezone(publishAt, config.timezone),
      notes: [
        "No native scheduling — the runner fires this at the target time.",
        inboxFlow(input)
          ? "No consent answers on this post: the clip goes to your TikTok inbox, where you choose audience and interactions before it posts."
          : "Direct post to " + privacyLevel(input) + ", with the interaction and disclosure settings the creator chose.",
        uploadMode() === "url" ? "Source: PULL_FROM_URL from hosted media." : "Source: FILE_UPLOAD (direct binary, no hosting needed)."
      ]
    };
  },

  async publish(input: PublishInput): Promise<PostResult> {
    if (isImagePost(input.item)) throw new PermanentError(IMAGE_REFUSALS.tiktok!);
    const token = await accessToken();

    // Resume: if a previous run already initialized/uploaded, just poll.
    const pending = input.item.platforms.tiktok?.containerId;
    if (pending) return pollStatus(pending, token);

    // TikTok requires creator_info immediately before a direct post, and it is
    // the only way to know the creator has not turned an interaction off since
    // they consented. The inbox flow asks nothing of the creator, so it needs
    // neither the call nor the check.
    if (!inboxFlow(input)) input = await withCurrentCreatorSettings(input, token);

    const size = (await stat(input.localPath)).size;
    const initPayload = await fetchJson<TiktokEnvelope<{ publish_id?: string; upload_url?: string }>>(
      initEndpoint(input),
      {
        label: "TikTok publish init",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify(buildInitBody(input, size))
      }
    ).catch((error: unknown) => {
      const throttled = error instanceof Error ? throttleFor(error.message, "TikTok publish init") : null;
      throw throttled ?? error;
    });
    const init = assertOk(initPayload, "TikTok publish init");
    if (!init.publish_id) throw new PermanentError("TikTok publish init returned no publish_id.");

    if (uploadMode() === "file") {
      if (!init.upload_url) throw new PermanentError("TikTok publish init returned no upload_url for FILE_UPLOAD.");
      await uploadChunks(init.upload_url, input.localPath, size);
    }
    return pollStatus(init.publish_id, token);
  }
};
