import { publisherConfig } from "@/lib/publisher/config";
import { AbandonedUploadError, PermanentError, StillProcessingError, TransientError, fetchJson } from "@/lib/publisher/http";
import { MAX_IMAGES_PER_POST, isCarouselPost, isImagePost } from "@/lib/publisher/images";
import { composeCaption } from "@/lib/publisher/metadata";
import { formatInTimezone, toRfc3339Utc } from "@/lib/publisher/time";
import type { PlatformAdapter, PostResult, PublishInput, PublishPlan } from "@/lib/publisher/types";

/**
 * Facebook Graph API — Video Reels publishing on a Page.
 *
 * Requires a Facebook Page and a Page access token (not a user token) with
 * the pages_manage_posts / pages_read_engagement permissions.
 *
 * Publishing is the documented three-phase flow:
 *   1. POST /{page-id}/video_reels?upload_phase=start → { video_id, upload_url }.
 *      The start call opens a session ONLY. It takes no file_url: passing one
 *      here is accepted and then ignored, which is exactly how this adapter
 *      spent a month opening sessions Facebook never fetched a byte for.
 *   2. POST the upload_url on rupload.facebook.com with an `Authorization:
 *      OAuth <token>` header and a `file_url:` HEADER naming the hosted clip.
 *      That is the hosted-file variant of the transfer phase; the local-file
 *      variant sends the bytes with offset/file_size headers instead.
 *   3. Poll  GET /{video-id}?fields=status until video_status is "ready", then
 *      POST /{page-id}/video_reels?upload_phase=finish&video_id=...
 *      &video_state=PUBLISHED → published Reel.
 *
 * Like Instagram, there is no server-side scheduling for this API, so the
 * runner only invokes this adapter once publishAt is due.
 *
 * A session that never leaves "uploading" is dead, not slow: past
 * ABANDON_AFTER_MS from the first upload it fails for real, the handle is
 * dropped and the post is sent again from scratch.
 */

const POLL_INTERVAL_MS = 10_000;
const DEFAULT_POLL_BUDGET_MS = 60_000;
const ABANDON_AFTER_MS = 2 * 60 * 60 * 1000;

function graphBase(): string {
  return `https://graph.facebook.com/${publisherConfig().facebook.graphApiVersion}`;
}

function credentials(): { pageId: string; accessToken: string } {
  const { facebook } = publisherConfig();
  if (!facebook.pageId || !facebook.pageAccessToken) {
    throw new PermanentError("Facebook is not configured. Set FB_PAGE_ID and FB_PAGE_ACCESS_TOKEN.");
  }
  return { pageId: facebook.pageId, accessToken: facebook.pageAccessToken };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function videoStatus(videoId: string, accessToken: string): Promise<string> {
  // VERIFY: the status payload nests video_status under a "status" object per
  // the Video Reels publishing reference.
  const data = await fetchJson<{ status?: { video_status?: string } }>(
    `${graphBase()}/${videoId}?fields=status&access_token=${encodeURIComponent(accessToken)}`,
    { label: "Facebook video status", method: "GET" }
  );
  return data.status?.video_status ?? "UNKNOWN";
}

function ruploadUrl(videoId: string): string {
  return `https://rupload.facebook.com/video-upload/${publisherConfig().facebook.graphApiVersion}/${videoId}`;
}

async function transferHostedFile(uploadUrl: string, fileUrl: string, accessToken: string): Promise<void> {
  const data = await fetchJson<{ success?: boolean }>(uploadUrl, {
    label: "Facebook video_reels hosted file transfer",
    headers: { Authorization: `OAuth ${accessToken}`, file_url: fileUrl }
  });
  if (data.success === false) {
    throw new TransientError("Facebook did not accept the hosted video URL for this upload session.");
  }
}

function abandonedFor(uploadedAt: string | undefined, now: number): number | null {
  if (!uploadedAt) return null;
  const started = new Date(uploadedAt).getTime();
  if (!Number.isFinite(started)) return null;
  const age = now - started;
  return age >= ABANDON_AFTER_MS ? age : null;
}

async function finishUpload(
  videoId: string,
  caption: string,
  creds: { pageId: string; accessToken: string }
): Promise<PostResult> {
  const data = await fetchJson<{ success?: boolean }>(`${graphBase()}/${creds.pageId}/video_reels`, {
    label: "Facebook video_reels finish",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      upload_phase: "finish",
      video_id: videoId,
      video_state: "PUBLISHED",
      description: caption,
      access_token: creds.accessToken
    })
  });
  if (!data.success) throw new PermanentError("Facebook video_reels finish did not report success.");
  return { status: "published", postId: videoId, containerId: videoId, detail: "reel published" };
}

async function uploadPhoto(
  creds: { pageId: string; accessToken: string },
  fields: Record<string, string>
): Promise<string> {
  const data = await fetchJson<{ id?: string; post_id?: string }>(`${graphBase()}/${creds.pageId}/photos`, {
    label: "Facebook photo upload",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, access_token: creds.accessToken })
  });
  if (!data.id) throw new PermanentError("Facebook photo upload returned no id.");
  return data.id;
}

/**
 * A picture post on the Page.
 *
 * One picture: POST /{page-id}/photos (url, caption, published=true) — the
 * photo IS the post, so there is nothing to poll and nothing to finish.
 * Several: each picture is uploaded with published=false, then one feed post
 * attaches them all — that is the only way the Graph API makes a multi-photo
 * post, and the unpublished photos never show on the Page on their own.
 *
 * A retry after the feed post landed is stopped by the recorded postId in the
 * runner, so nothing here can post twice. A retry BEFORE it landed re-uploads
 * the unpublished photos; those are not posts and Facebook drops them.
 */
async function publishImagePost(input: PublishInput, creds: { pageId: string; accessToken: string }): Promise<PostResult> {
  const urls = input.images?.publicUrls ?? [];
  if (urls.length === 0) {
    throw new PermanentError(
      "Facebook needs a public HTTPS URL per picture. Configure the S3_* variables so images are hosted (Cloudflare R2 free tier works)."
    );
  }
  if (urls.length > MAX_IMAGES_PER_POST) {
    throw new PermanentError(`A Facebook picture post carries at most ${MAX_IMAGES_PER_POST} photos — this one has ${urls.length}.`);
  }
  const caption = composeCaption(input.item);

  if (!isCarouselPost(input.item)) {
    const photoId = await uploadPhoto(creds, { url: urls[0], caption, published: "true" });
    return { status: "published", postId: photoId, detail: "photo published" };
  }

  const existing = input.item.platforms.facebook?.childContainerIds ?? [];
  const photoIds =
    existing.length === urls.length
      ? existing
      : await urls.reduce<Promise<string[]>>(async (chain, url) => {
          const ids = await chain;
          ids.push(await uploadPhoto(creds, { url, published: "false" }));
          return ids;
        }, Promise.resolve([]));

  const body = new URLSearchParams({ message: caption, access_token: creds.accessToken });
  photoIds.forEach((id, index) => body.append(`attached_media[${index}]`, JSON.stringify({ media_fbid: id })));
  const post = await fetchJson<{ id?: string }>(`${graphBase()}/${creds.pageId}/feed`, {
    label: "Facebook multi-photo feed post",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!post.id) throw new PermanentError("Facebook feed post returned no id.");
  return { status: "published", postId: post.id, childContainerIds: photoIds, detail: `${photoIds.length} photos published` };
}

export const facebookAdapter: PlatformAdapter = {
  id: "facebook",

  configured(): boolean {
    const { facebook } = publisherConfig();
    return Boolean(facebook.pageId && facebook.pageAccessToken);
  },

  async validateAuth(): Promise<void> {
    const creds = credentials();
    // Cheap read that also exercises the token: the Page's own profile fields.
    await fetchJson(`${graphBase()}/${creds.pageId}?fields=id,name&access_token=${encodeURIComponent(creds.accessToken)}`, {
      label: "Facebook auth check",
      method: "GET"
    });
  },

  buildPlan(input: PublishInput): PublishPlan {
    const config = publisherConfig();
    const publishAt = new Date(input.item.publishAt);
    if (isImagePost(input.item)) {
      const count = input.images?.publicUrls.length ?? input.item.imagePaths?.length ?? 1;
      return {
        platform: "facebook",
        endpoint:
          count > 1
            ? `${graphBase()}/{page-id}/photos (published=false) → /{page-id}/feed`
            : `${graphBase()}/{page-id}/photos`,
        payload: {
          photos: count,
          url: input.images?.publicUrls[0] ?? "<hosted URL minted at publish time>",
          message: composeCaption(input.item)
        },
        publishAtUtc: toRfc3339Utc(publishAt),
        publishAtLocal: formatInTimezone(publishAt, config.timezone),
        notes: [
          "No native scheduling — the runner fires this at the target time.",
          "Requires a Page access token (not a user token) with pages_manage_posts.",
          count > 1 ? "Each photo is uploaded unpublished, then one feed post attaches them all." : "The photo is the post."
        ]
      };
    }
    return {
      platform: "facebook",
      endpoint: `${graphBase()}/{page-id}/video_reels (start → finish)`,
      payload: {
        upload_phase: "start",
        file_url: input.publicUrl ?? "<hosted URL minted at publish time>",
        description: composeCaption(input.item)
      },
      publishAtUtc: toRfc3339Utc(publishAt),
      publishAtLocal: formatInTimezone(publishAt, config.timezone),
      notes: [
        "No native scheduling — the runner fires this at the target time.",
        "Requires a Page access token (not a user token) with pages_manage_posts.",
        "Reels published through the API always post to the Page as public."
      ]
    };
  },

  async publish(input: PublishInput): Promise<PostResult> {
    const creds = credentials();
    if (input.item.visibility !== "public") {
      throw new PermanentError(
        "Facebook Reels published through the API are always public — there is no private/draft option. " +
          "Set this item's visibility to public (or point FB_PAGE_ID/FB_PAGE_ACCESS_TOKEN at a test Page) and re-enqueue."
      );
    }

    if (isImagePost(input.item)) return publishImagePost(input, creds);

    const caption = composeCaption(input.item);

    // Resume a video from a previous run instead of starting a duplicate.
    let videoId = input.item.platforms.facebook?.containerId;

    if (!videoId) {
      if (!input.publicUrl) {
        throw new PermanentError(
          "Facebook needs a public HTTPS video URL. Configure the S3_* variables so clips are hosted (Cloudflare R2 free tier works)."
        );
      }
      const started = await fetchJson<{ video_id?: string; upload_url?: string }>(`${graphBase()}/${creds.pageId}/video_reels`, {
        label: "Facebook video_reels start",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          upload_phase: "start",
          access_token: creds.accessToken
        })
      });
      if (!started.video_id) throw new PermanentError("Facebook video_reels start returned no video_id.");
      videoId = started.video_id;
      await transferHostedFile(started.upload_url ?? ruploadUrl(videoId), input.publicUrl, creds.accessToken);
    }

    const uploadedAt = input.item.platforms.facebook?.uploadedAt;
    const pollUntil = Date.now() + Math.max(0, input.pollBudgetMs ?? DEFAULT_POLL_BUDGET_MS);
    for (;;) {
      const status = await videoStatus(videoId, creds.accessToken);
      if (status === "ready" || status === "READY") return finishUpload(videoId, caption, creds);
      if (status === "published" || status === "PUBLISHED") {
        return { status: "published", postId: videoId, containerId: videoId, detail: "already published" };
      }
      if (status === "error" || status === "ERROR") {
        throw new PermanentError("Facebook could not process the video (video_status ERROR). Check the Reels format requirements (MP4/MOV, 9:16).");
      }
      if (status === "expired" || status === "EXPIRED") {
        // Uploads expire before finishing; a fresh attempt will start a new one.
        throw new AbandonedUploadError(videoId, "Facebook video upload expired before publishing — a new upload will be started on retry.");
      }
      const abandonedMs = abandonedFor(uploadedAt, Date.now());
      if (abandonedMs !== null) {
        throw new AbandonedUploadError(
          videoId,
          `Facebook never fetched the video — this upload has been stuck at "${status}" for ${Math.round(abandonedMs / 3_600_000)}h. ` +
            "The dead upload was dropped and the whole post will be sent again from scratch."
        );
      }
      if (Date.now() + POLL_INTERVAL_MS >= pollUntil) break;
      await wait(POLL_INTERVAL_MS);
    }
    // Still processing: keep the video id so the next run resumes it instead
    // of starting a duplicate upload.
    throw new StillProcessingError(videoId, "Facebook is still processing the video — will resume on the next run.");
  }
};
