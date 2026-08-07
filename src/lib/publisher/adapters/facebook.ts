import { publisherConfig } from "@/lib/publisher/config";
import { PermanentError, StillProcessingError, TransientError, fetchJson } from "@/lib/publisher/http";
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
 *   1. POST /{page-id}/video_reels?upload_phase=start&file_url=...
 *      → { video_id, upload_url }. Passing file_url lets Facebook pull the
 *      clip from the public HTTPS URL directly, so no binary upload step is
 *      needed here (clips are hosted (R2) before this call, same as IG).
 *   2. Poll  GET /{video-id}?fields=status until video_status is "ready".
 *   3. POST /{page-id}/video_reels?upload_phase=finish&video_id=...
 *      &video_state=PUBLISHED → published Reel.
 *
 * Like Instagram, there is no server-side scheduling for this API, so the
 * runner only invokes this adapter once publishAt is due.
 */

const POLL_INTERVAL_MS = 10_000;
const MAX_POLLS_PER_RUN = 24; // ~4 minutes; longer processing resumes next run

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
      const started = await fetchJson<{ video_id?: string }>(`${graphBase()}/${creds.pageId}/video_reels`, {
        label: "Facebook video_reels start",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          upload_phase: "start",
          file_url: input.publicUrl,
          access_token: creds.accessToken
        })
      });
      if (!started.video_id) throw new PermanentError("Facebook video_reels start returned no video_id.");
      videoId = started.video_id;
    }

    for (let poll = 0; poll < MAX_POLLS_PER_RUN; poll += 1) {
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
        throw new TransientError("Facebook video upload expired before publishing — a new upload will be started on retry.");
      }
      await wait(POLL_INTERVAL_MS);
    }
    // Still processing: keep the video id so the next run resumes it instead
    // of starting a duplicate upload.
    throw new StillProcessingError(videoId, "Facebook is still processing the video — will resume on the next run.");
  }
};
