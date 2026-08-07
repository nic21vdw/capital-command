import { publisherConfig } from "@/lib/publisher/config";
import { PermanentError, StillProcessingError, TransientError, fetchJson } from "@/lib/publisher/http";
import { MAX_IMAGES_PER_POST, isCarouselPost, isImagePost } from "@/lib/publisher/images";
import { composeCaption } from "@/lib/publisher/metadata";
import { formatInTimezone, toRfc3339Utc } from "@/lib/publisher/time";
import type { PlatformAdapter, PostResult, PublishInput, PublishPlan } from "@/lib/publisher/types";

/**
 * Instagram Graph API — Content Publishing (Reels).
 *
 * Requires an Instagram professional (Business/Creator) account linked to a
 * Facebook Page and a Meta app with instagram_content_publish permission.
 *
 * Publishing is the documented two-step flow:
 *   1. POST /{ig-user-id}/media          (media_type=REELS, video_url, caption)
 *      → creation container id. Instagram downloads the video from the public
 *      HTTPS URL, so clips are hosted (R2) before this call.
 *   2. Poll  GET /{container-id}?fields=status_code until FINISHED.
 *   3. POST /{ig-user-id}/media_publish  (creation_id) → live media id.
 *
 * The base Content Publishing API has no server-side scheduling, so this
 * adapter is only invoked by the runner once publishAt is due. Accounts are
 * limited to ~50 API-published posts per rolling 24 hours.
 */

const POLL_INTERVAL_MS = 10_000;
const MAX_POLLS_PER_RUN = 24; // ~4 minutes; longer processing resumes next run

function graphBase(): string {
  return `https://graph.facebook.com/${publisherConfig().instagram.graphApiVersion}`;
}

function credentials(): { userId: string; accessToken: string } {
  const { instagram } = publisherConfig();
  if (!instagram.userId || !instagram.accessToken) {
    throw new PermanentError("Instagram is not configured. Set IG_USER_ID and IG_ACCESS_TOKEN.");
  }
  return { userId: instagram.userId, accessToken: instagram.accessToken };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function containerStatus(containerId: string, accessToken: string): Promise<string> {
  const data = await fetchJson<{ status_code?: string }>(
    `${graphBase()}/${containerId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`,
    { label: "Instagram container status", method: "GET" }
  );
  return data.status_code ?? "UNKNOWN";
}

async function publishContainer(containerId: string, creds: { userId: string; accessToken: string }): Promise<PostResult> {
  const data = await fetchJson<{ id?: string }>(`${graphBase()}/${creds.userId}/media_publish`, {
    label: "Instagram media_publish",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: containerId, access_token: creds.accessToken })
  });
  if (!data.id) throw new PermanentError("Instagram media_publish returned no media id.");
  return { status: "published", postId: data.id, containerId, detail: "container published" };
}

/** Refuses to start a post when the account is already at the 24h ceiling. */
async function assertQuota(creds: { userId: string; accessToken: string }): Promise<void> {
  const quota = await fetchJson<{ data?: Array<{ quota_usage?: number }> }>(
    `${graphBase()}/${creds.userId}/content_publishing_limit?fields=quota_usage&access_token=${encodeURIComponent(creds.accessToken)}`,
    { label: "Instagram publishing quota", method: "GET" }
  ).catch(() => null);
  const usage = quota?.data?.[0]?.quota_usage;
  if (typeof usage === "number" && usage >= 50) {
    throw new TransientError(`Instagram publishing quota reached (${usage}/50 in 24h) — retrying later.`);
  }
}

async function createImageContainer(
  creds: { userId: string; accessToken: string },
  fields: Record<string, string>
): Promise<string> {
  const created = await fetchJson<{ id?: string }>(`${graphBase()}/${creds.userId}/media`, {
    label: "Instagram image container create",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, access_token: creds.accessToken })
  });
  if (!created.id) throw new PermanentError("Instagram image container create returned no id.");
  return created.id;
}

/**
 * A single picture, or a carousel of them.
 *
 * Single: POST /media (image_url, caption) → poll → media_publish.
 * Carousel: one child container per picture (is_carousel_item=true), then a
 * parent container (media_type=CAROUSEL, children=…) → poll → media_publish.
 *
 * A retry that already has the PARENT container resumes it, so nothing is
 * created twice once the post has a handle. A retry that never got that far
 * makes fresh child containers — an unpublished container is not a post, it
 * costs nothing and expires in 24 hours.
 */
async function publishImagePost(input: PublishInput, creds: { userId: string; accessToken: string }): Promise<PostResult> {
  const urls = input.images?.publicUrls ?? [];
  if (urls.length === 0) {
    throw new PermanentError(
      "Instagram needs a public HTTPS URL per picture. Configure the S3_* variables so images are hosted (Cloudflare R2 free tier works)."
    );
  }
  if (urls.length > MAX_IMAGES_PER_POST) {
    throw new PermanentError(`Instagram carousels hold at most ${MAX_IMAGES_PER_POST} pictures — this post has ${urls.length}.`);
  }
  const carousel = isCarouselPost(input.item);
  const caption = composeCaption(input.item).slice(0, 2200);

  let containerId = input.item.platforms.instagram?.containerId;
  let childIds: string[] | undefined;

  if (!containerId) {
    await assertQuota(creds);
    if (!carousel) {
      containerId = await createImageContainer(creds, { image_url: urls[0], caption });
    } else {
      childIds = [];
      for (const url of urls) {
        childIds.push(await createImageContainer(creds, { image_url: url, is_carousel_item: "true" }));
      }
      containerId = await createImageContainer(creds, {
        media_type: "CAROUSEL",
        children: childIds.join(","),
        caption
      });
    }
  }

  for (let poll = 0; poll < MAX_POLLS_PER_RUN; poll += 1) {
    const status = await containerStatus(containerId, creds.accessToken);
    if (status === "FINISHED") {
      const result = await publishContainer(containerId, creds);
      return { ...result, ...(childIds ? { childContainerIds: childIds } : {}), detail: carousel ? "carousel published" : "image published" };
    }
    if (status === "PUBLISHED") return { status: "published", postId: containerId, containerId, detail: "already published" };
    if (status === "ERROR") {
      throw new PermanentError(
        "Instagram could not process the picture(s) (container status ERROR). Instagram takes JPEG at 320–1440px wide, aspect 4:5 to 1.91:1."
      );
    }
    if (status === "EXPIRED") {
      throw new TransientError("Instagram container expired before publishing — a new one will be created on retry.");
    }
    await wait(POLL_INTERVAL_MS);
  }
  throw new StillProcessingError(containerId, "Instagram is still processing the picture(s) — will resume on the next run.");
}

export const instagramAdapter: PlatformAdapter = {
  id: "instagram",

  configured(): boolean {
    const { instagram } = publisherConfig();
    return Boolean(instagram.userId && instagram.accessToken);
  },

  async validateAuth(): Promise<void> {
    const creds = credentials();
    // Cheap read that also exercises the token: current publishing quota usage.
    await fetchJson(
      `${graphBase()}/${creds.userId}/content_publishing_limit?fields=quota_usage&access_token=${encodeURIComponent(creds.accessToken)}`,
      { label: "Instagram auth check", method: "GET" }
    );
  },

  buildPlan(input: PublishInput): PublishPlan {
    const config = publisherConfig();
    const publishAt = new Date(input.item.publishAt);
    if (isImagePost(input.item)) {
      const count = input.images?.publicUrls.length ?? input.item.imagePaths?.length ?? 1;
      return {
        platform: "instagram",
        endpoint: `${graphBase()}/{ig-user-id}/media → /{ig-user-id}/media_publish`,
        payload: {
          media_type: count > 1 ? "CAROUSEL" : "IMAGE",
          images: count,
          image_url: input.images?.publicUrls[0] ?? "<hosted URL minted at publish time>",
          caption: composeCaption(input.item).slice(0, 2200)
        },
        publishAtUtc: toRfc3339Utc(publishAt),
        publishAtLocal: formatInTimezone(publishAt, config.timezone),
        notes: [
          "No native scheduling — the runner fires this at the target time.",
          count > 1 ? "One child container per picture, then a CAROUSEL parent." : "One image container.",
          "Counts toward the ~50 API posts per 24h limit."
        ]
      };
    }
    return {
      platform: "instagram",
      endpoint: `${graphBase()}/{ig-user-id}/media → /{ig-user-id}/media_publish`,
      payload: {
        media_type: "REELS",
        video_url: input.publicUrl ?? "<hosted URL minted at publish time>",
        caption: composeCaption(input.item).slice(0, 2200),
        share_to_feed: true
      },
      publishAtUtc: toRfc3339Utc(publishAt),
      publishAtLocal: formatInTimezone(publishAt, config.timezone),
      notes: [
        "No native scheduling — the runner fires this at the target time.",
        "Reels published via the API are always public; use a separate test account for trial runs.",
        "Counts toward the ~50 API posts per 24h limit."
      ]
    };
  },

  async publish(input: PublishInput): Promise<PostResult> {
    const creds = credentials();
    if (input.item.visibility !== "public") {
      throw new PermanentError(
        "Instagram Reels published through the API are always public — there is no private/draft option. " +
          "Set this item's visibility to public (or point IG_USER_ID/IG_ACCESS_TOKEN at a test account) and re-enqueue."
      );
    }

    if (isImagePost(input.item)) return publishImagePost(input, creds);

    // Resume a container from a previous run instead of creating a duplicate.
    let containerId = input.item.platforms.instagram?.containerId;

    if (!containerId) {
      if (!input.publicUrl) {
        throw new PermanentError(
          "Instagram needs a public HTTPS video URL. Configure the S3_* variables so clips are hosted (Cloudflare R2 free tier works)."
        );
      }
      // Stay under the rolling 24h publishing limit rather than burning a post.
      await assertQuota(creds);

      const created = await fetchJson<{ id?: string }>(`${graphBase()}/${creds.userId}/media`, {
        label: "Instagram container create",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          media_type: "REELS",
          video_url: input.publicUrl,
          caption: composeCaption(input.item).slice(0, 2200),
          share_to_feed: "true",
          access_token: creds.accessToken
        })
      });
      if (!created.id) throw new PermanentError("Instagram container create returned no id.");
      containerId = created.id;
    }

    for (let poll = 0; poll < MAX_POLLS_PER_RUN; poll += 1) {
      const status = await containerStatus(containerId, creds.accessToken);
      if (status === "FINISHED") return publishContainer(containerId, creds);
      if (status === "PUBLISHED") return { status: "published", postId: containerId, containerId, detail: "already published" };
      if (status === "ERROR") {
        throw new PermanentError("Instagram could not process the video (container status ERROR). Check the Reels format requirements (MP4/MOV, 9:16, ≤15 min).");
      }
      if (status === "EXPIRED") {
        // Containers expire ~24h after creation; a fresh attempt will make a new one.
        throw new TransientError("Instagram container expired before publishing — a new container will be created on retry.");
      }
      await wait(POLL_INTERVAL_MS);
    }
    // Still processing: keep the container id so the next run resumes it
    // instead of creating a duplicate container.
    throw new StillProcessingError(containerId, "Instagram is still processing the video — will resume on the next run.");
  }
};
