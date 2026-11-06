import { PermanentError, StillProcessingError, fetchJson } from "@/lib/publisher/http";
import { hostMedia, mediaHost } from "@/lib/publisher/hosting";
import { composeCaption } from "@/lib/publisher/metadata";
import type { PostResult, PublishInput } from "@/lib/publisher/types";

/**
 * TikTok through Buffer (buffer.com), whose TikTok client is audited.
 *
 * Buffer's Free plan publishes TikTok videos automatically, and its GraphQL
 * API takes a personal API key. So with BUFFER_API_KEY set the runner hands
 * each TikTok leg to Buffer at its slot with mode shareNow, and Buffer posts
 * it to the profile: free, and no tap. Buffer fetches the video from a public
 * URL, which the S3/R2 media host already provides.
 *
 * BUFFER_TIKTOK_CHANNEL_ID picks the channel; without it the first connected
 * TikTok channel in the account is used.
 */

export const BUFFER_GRAPHQL_URL = "https://api.buffer.com";
export const BUFFER_HANDLE_PREFIX = "buffer:";
const POLL_INTERVAL_MS = 10_000;
const MAX_POLLS_PER_RUN = 18;

export type BufferTiktokCredentials = { apiKey: string; channelId: string | null };

type GraphqlResponse<T> = { data?: T; errors?: Array<{ message?: string; extensions?: { code?: string } }> };

type BufferPost = {
  id?: string;
  status?: string;
  externalLink?: string | null;
  error?: { message?: string } | null;
};

const POST_FIELDS = "id status externalLink error { message }";

export function isBufferHandle(containerId: string | undefined): boolean {
  return Boolean(containerId?.startsWith(BUFFER_HANDLE_PREFIX));
}

async function graphql<T>(apiKey: string, label: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const payload = await fetchJson<GraphqlResponse<T>>(BUFFER_GRAPHQL_URL, {
    label,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables })
  });
  if (payload.errors?.length) {
    throw new PermanentError(`${label}: ${payload.errors.map((e) => e.message ?? e.extensions?.code ?? "error").join("; ")}`);
  }
  if (!payload.data) throw new PermanentError(`${label} returned no data.`);
  return payload.data;
}

const channelCache = new Map<string, string>();

export async function bufferTiktokChannel(credentials: BufferTiktokCredentials): Promise<string> {
  if (credentials.channelId) return credentials.channelId;
  const cached = channelCache.get(credentials.apiKey);
  if (cached) return cached;
  const { account } = await graphql<{ account: { organizations: Array<{ id: string }> } }>(
    credentials.apiKey,
    "Buffer account",
    "query { account { organizations { id } } }"
  );
  for (const organization of account.organizations) {
    const { channels } = await graphql<{ channels: Array<{ id: string; service: string; isDisconnected: boolean; isLocked: boolean }> }>(
      credentials.apiKey,
      "Buffer channels",
      "query Channels($organizationId: OrganizationId!) { channels(input: { organizationId: $organizationId }) { id service isDisconnected isLocked } }",
      { organizationId: organization.id }
    );
    const tiktok = channels.find((channel) => channel.service === "tiktok" && !channel.isDisconnected && !channel.isLocked);
    if (tiktok) {
      channelCache.set(credentials.apiKey, tiktok.id);
      return tiktok.id;
    }
  }
  throw new PermanentError("Buffer has no connected TikTok channel — connect TikTok at publish.buffer.com, or set BUFFER_TIKTOK_CHANNEL_ID.");
}

function settled(post: BufferPost, handle: string): PostResult | null {
  if (post.status === "sent") {
    return {
      status: "published",
      postId: post.externalLink ?? handle,
      containerId: handle,
      detail: post.externalLink ? `Posted to TikTok via Buffer: ${post.externalLink}` : "Posted to TikTok via Buffer."
    };
  }
  if (post.status === "error") {
    throw new PermanentError(`TikTok (via Buffer) refused the post: ${post.error?.message ?? "no reason given"}`);
  }
  return null;
}

export async function pollBufferPost(handle: string, apiKey: string, polls = MAX_POLLS_PER_RUN): Promise<PostResult> {
  const id = handle.slice(BUFFER_HANDLE_PREFIX.length);
  for (let poll = 0; poll < polls; poll += 1) {
    const { post } = await graphql<{ post: BufferPost }>(
      apiKey,
      "Buffer post status",
      `query Post($id: PostId!) { post(input: { id: $id }) { ${POST_FIELDS} } }`,
      { id }
    );
    const done = settled(post, handle);
    if (done) return done;
    if (poll < polls - 1) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new StillProcessingError(handle, "Buffer is still sending this to TikTok — will check again on the next run.");
}

async function videoUrl(input: PublishInput): Promise<string> {
  if (input.publicUrl) return input.publicUrl;
  const host = mediaHost();
  if (!host) throw new PermanentError("Buffer fetches the video from a public URL, and media hosting is not configured. Set the S3_* variables.");
  const { key } = await hostMedia(input.localPath, input.item.id);
  return host.publicUrl(key);
}

export async function publishViaBuffer(input: PublishInput, credentials: BufferTiktokCredentials): Promise<PostResult> {
  const pending = input.item.platforms.tiktok?.containerId;
  if (isBufferHandle(pending)) return pollBufferPost(pending!, credentials.apiKey);

  const channelId = await bufferTiktokChannel(credentials);
  const { createPost } = await graphql<{ createPost: { post?: BufferPost; message?: string } }>(
    credentials.apiKey,
    "Buffer create TikTok post",
    `mutation Create($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { ${POST_FIELDS} } }
        ... on MutationError { message }
      }
    }`,
    {
      input: {
        channelId,
        text: composeCaption(input.item, "tiktok", 2200),
        schedulingType: "automatic",
        mode: "shareNow",
        assets: [{ video: { url: await videoUrl(input) } }]
      }
    }
  );
  if (!createPost.post?.id) {
    throw new PermanentError(`Buffer did not take the TikTok post: ${createPost.message ?? "no reason given"}`);
  }
  const handle = `${BUFFER_HANDLE_PREFIX}${createPost.post.id}`;
  await input.onHandle?.(handle);
  return settled(createPost.post, handle) ?? pollBufferPost(handle, credentials.apiKey);
}

export async function validateBufferTiktok(credentials: BufferTiktokCredentials): Promise<void> {
  await bufferTiktokChannel(credentials);
}
