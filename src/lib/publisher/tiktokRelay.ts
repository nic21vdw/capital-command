import { readFile } from "node:fs/promises";
import path from "node:path";
import { PermanentError, StillProcessingError, fetchJson } from "@/lib/publisher/http";
import { composeCaption } from "@/lib/publisher/metadata";
import type { PostResult, PublishInput } from "@/lib/publisher/types";

/**
 * TikTok through Upload-Post (upload-post.com), an audited TikTok partner.
 *
 * This app's own TikTok client was refused review for personal use, so it can
 * only leave drafts in the inbox. Upload-Post's client is audited, so a post
 * sent through it goes straight to the profile with the audience asked for:
 * the same at-the-slot posting Instagram and Facebook get, with no tap.
 *
 * On when UPLOAD_POST_API_KEY and UPLOAD_POST_USER are both set. The TikTok
 * account is connected inside Upload-Post, under that profile.
 */

export const RELAY_API_BASE = "https://api.upload-post.com/api";
export const RELAY_HANDLE_PREFIX = "upload-post:";
const UPLOAD_TIMEOUT_MS = 10 * 60_000;
const POLL_INTERVAL_MS = 10_000;
const MAX_POLLS_PER_RUN = 18;

export type RelayCredentials = { apiKey: string; user: string };

type RelayPlatformResult = {
  success?: boolean;
  url?: string;
  publish_id?: string;
  post_id?: string;
  error?: string;
  message?: string;
};

type RelayUploadResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  request_id?: string;
  results?: Record<string, RelayPlatformResult>;
};

type RelayStatusResponse = {
  status?: string;
  results?: Array<RelayPlatformResult & { platform?: string }>;
};

export function isRelayHandle(containerId: string | undefined): boolean {
  return Boolean(containerId?.startsWith(RELAY_HANDLE_PREFIX));
}

export function relayPrivacy(input: PublishInput): string {
  return input.item.tiktok?.privacyLevel ?? (input.item.visibility === "public" ? "PUBLIC_TO_EVERYONE" : "SELF_ONLY");
}

export function relayFields(input: PublishInput, user: string): Record<string, string> {
  const consent = input.item.tiktok;
  const off = (allowed: boolean | undefined) => String(consent ? allowed !== true : false);
  return {
    user,
    "platform[]": "tiktok",
    title: composeCaption(input.item, "tiktok", 2200),
    privacy_level: relayPrivacy(input),
    post_mode: "DIRECT_POST",
    disable_comment: off(consent?.allowComment),
    disable_duet: off(consent?.allowDuet),
    disable_stitch: off(consent?.allowStitch),
    brand_content_toggle: String(consent?.brandedContent === true),
    brand_organic_toggle: String(consent?.brandOrganic === true),
    async_upload: "true"
  };
}

function authHeader(apiKey: string): Record<string, string> {
  return { Authorization: `Apikey ${apiKey}` };
}

function planRefusal(error: unknown): never {
  if (error instanceof PermanentError && /HTTP 403/.test(error.message)) {
    throw new PermanentError(
      `${error.message} — Upload-Post refuses TikTok on its free plan, and on a profile with no TikTok connected. Check the plan and the TikTok connection at app.upload-post.com.`
    );
  }
  throw error;
}

function published(result: RelayPlatformResult, handle: string): PostResult {
  return {
    status: "published",
    postId: result.post_id ?? result.publish_id ?? result.url ?? handle,
    containerId: handle,
    detail: result.url ? `Posted to TikTok via Upload-Post: ${result.url}` : "Posted to TikTok via Upload-Post."
  };
}

export async function pollRelay(handle: string, credentials: RelayCredentials, polls = MAX_POLLS_PER_RUN): Promise<PostResult> {
  const requestId = handle.slice(RELAY_HANDLE_PREFIX.length);
  for (let poll = 0; poll < polls; poll += 1) {
    const data = await fetchJson<RelayStatusResponse>(
      `${RELAY_API_BASE}/uploadposts/status?request_id=${encodeURIComponent(requestId)}`,
      { label: "Upload-Post status", method: "GET", headers: authHeader(credentials.apiKey) }
    );
    const result = data.results?.find((entry) => (entry.platform ?? "tiktok") === "tiktok");
    if (data.status === "completed" || result?.success !== undefined) {
      if (result?.success) return published(result, handle);
      throw new PermanentError(`TikTok (via Upload-Post) refused the post: ${result?.error ?? result?.message ?? "no reason given"}`);
    }
    if (poll < polls - 1) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new StillProcessingError(handle, "Upload-Post is still sending this to TikTok — will check again on the next run.");
}

export async function publishViaRelay(input: PublishInput, credentials: RelayCredentials): Promise<PostResult> {
  const pending = input.item.platforms.tiktok?.containerId;
  if (isRelayHandle(pending)) return pollRelay(pending!, credentials);

  const form = new FormData();
  for (const [key, value] of Object.entries(relayFields(input, credentials.user))) form.append(key, value);
  form.append("video", new Blob([await readFile(input.localPath)], { type: "video/mp4" }), path.basename(input.localPath));

  const data = await fetchJson<RelayUploadResponse>(`${RELAY_API_BASE}/upload`, {
    label: "Upload-Post upload",
    headers: authHeader(credentials.apiKey),
    body: form,
    timeoutMs: UPLOAD_TIMEOUT_MS
  }).catch(planRefusal);
  if (data.success === false) {
    throw new PermanentError(`Upload-Post did not take the post: ${data.message ?? data.error ?? "no reason given"}`);
  }
  const direct = data.results?.tiktok;
  if (direct) {
    if (direct.success) return published(direct, `${RELAY_HANDLE_PREFIX}${direct.publish_id ?? "sync"}`);
    throw new PermanentError(`TikTok (via Upload-Post) refused the post: ${direct.error ?? direct.message ?? "no reason given"}`);
  }
  if (!data.request_id) throw new PermanentError("Upload-Post returned neither a result nor a request_id.");
  return pollRelay(`${RELAY_HANDLE_PREFIX}${data.request_id}`, credentials);
}

export async function validateRelayAuth(credentials: RelayCredentials): Promise<void> {
  await fetchJson(`${RELAY_API_BASE}/uploadposts/users/${encodeURIComponent(credentials.user)}`, {
    label: "Upload-Post profile",
    method: "GET",
    headers: authHeader(credentials.apiKey)
  });
}
