import { publisherConfig } from "@/lib/publisher/config";
import { PermanentError, StillProcessingError, TransientError, fetchJson } from "@/lib/publisher/http";
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

    // Resume a container from a previous run instead of creating a duplicate.
    let containerId = input.item.platforms.instagram?.containerId;

    if (!containerId) {
      if (!input.publicUrl) {
        throw new PermanentError(
          "Instagram needs a public HTTPS video URL. Configure the S3_* variables so clips are hosted (Cloudflare R2 free tier works)."
        );
      }
      // Stay under the rolling 24h publishing limit rather than burning a post.
      const quota = await fetchJson<{ data?: Array<{ quota_usage?: number }> }>(
        `${graphBase()}/${creds.userId}/content_publishing_limit?fields=quota_usage&access_token=${encodeURIComponent(creds.accessToken)}`,
        { label: "Instagram publishing quota", method: "GET" }
      ).catch(() => null);
      const usage = quota?.data?.[0]?.quota_usage;
      if (typeof usage === "number" && usage >= 50) {
        throw new TransientError(`Instagram publishing quota reached (${usage}/50 in 24h) — retrying later.`);
      }

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
