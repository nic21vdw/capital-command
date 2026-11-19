import { PermanentError, TransientError, fetchJson, fetchRaw } from "@/lib/publisher/http";
import { isAuthFailure } from "@/lib/platform-health/auth";
import type { ThreadsVideoTarget } from "@/lib/threads/video";
import { attributeLinks } from "@/lib/publisher/attribution";
import { THREADS_TEXT_LIMIT, threadsConfig, type ThreadsAccount, type ThreadsConfig } from "@/lib/threads/config";

/**
 * Meta's Threads Graph API for text and explicitly approved video.
 *
 * Publishing is two calls: create a container for the text, then publish that
 * container. Every call is made as one specific account, so the two connected
 * profiles never share credentials.
 *
 * The access token travels in the request body or an Authorization header,
 * never in the URL, so it cannot end up in a log line or an error message.
 */

/**
 * Thrown when publishing has no trustworthy receipt. The container may be
 * live already; preserve its id and hold the send for owner reconciliation.
 */
export class ContainerPendingError extends TransientError {
  constructor(
    readonly containerId: string,
    message: string
  ) {
    super(message);
  }
}

/** A permanent rejection still carries the already-created container handle. */
export class ContainerRejectedError extends PermanentError {
  constructor(readonly containerId: string, message: string) {
    super(message);
  }
}

/** A control change interrupted delivery; it does not consume an attempt. */
export class ThreadsPublishPausedError extends Error {
  constructor(readonly containerId?: string) {
    super("Threads delivery was paused or switched off before publishing.");
  }
}

/** Processing is not a publish attempt. The worker can reuse the saved container. */
export class ThreadsVideoProcessingError extends TransientError {}

type CreateResponse = { id?: string };
type PublishResponse = { id?: string };
type ProfileResponse = { id?: string; username?: string };

function endpoint(config: ThreadsConfig, path: string): string {
  return `${config.apiBase}/${config.apiVersion}/${path}`;
}

const FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded" };

/** Ids resolved from a token, so the lookup happens once per process. */
const resolvedIds = new Map<string, string>();

/**
 * The account's numeric user id — configured, or looked up from the token.
 *
 * Meta hands you a token and makes you go hunting for the matching numeric id;
 * the token already knows it, so leaving THREADS_USER_ID blank is the normal
 * way to connect an account. Cached per token so a day of posting costs one
 * extra call at most.
 */
export async function accountUserId(account: ThreadsAccount, config: ThreadsConfig): Promise<string> {
  if (account.userId) return account.userId;
  const cached = resolvedIds.get(account.accessToken);
  if (cached) return cached;
  const profile = await fetchThreadsProfile(account, config);
  resolvedIds.set(account.accessToken, profile.id);
  return profile.id;
}

function textWithinLimit(text: string, attributionCode: string | undefined): string {
  const coded = attributeLinks(text, "threads", attributionCode);
  return coded.length > THREADS_TEXT_LIMIT ? attributeLinks(text, "threads") : coded;
}

/** Creates the text container. Returns its creation id. */
export async function createTextContainer(
  account: ThreadsAccount,
  text: string,
  config: ThreadsConfig = threadsConfig(),
  replyToId?: string,
  attributionCode?: string
): Promise<string> {
  const body = new URLSearchParams({ media_type: "TEXT", text: textWithinLimit(text, attributionCode), access_token: account.accessToken });
  if (replyToId) body.set("reply_to_id", replyToId);
  const userId = await accountUserId(account, config);

  const data = await fetchJson<CreateResponse>(endpoint(config, `${encodeURIComponent(userId)}/threads`), {
    label: `Threads container create (${account.label})`,
    headers: FORM_HEADERS,
    body
  });
  if (!data.id) throw new PermanentError("Threads accepted the text but returned no container id.");
  return data.id;
}

/** Publishes a previously created container. Returns the live post's media id. */
export async function publishContainer(
  account: ThreadsAccount,
  creationId: string,
  config: ThreadsConfig = threadsConfig(),
  blockRedirects = false
): Promise<string> {
  const body = new URLSearchParams({ creation_id: creationId, access_token: account.accessToken });
  const userId = await accountUserId(account, config);

  // A successful HTTP response without a readable receipt is still an
  // uncertain send. Only an explicit rejection can prove nothing went live.
  const response = await fetchRaw(endpoint(config, `${encodeURIComponent(userId)}/threads_publish`), {
    label: `Threads publish (${account.label})`,
    headers: FORM_HEADERS,
    body,
    timeoutMs: 20_000,
    ...(blockRedirects ? { redirect: "error" } : {})
  });
  const data = await response.json() as PublishResponse;
  if (typeof data.id !== "string" || !data.id.trim()) throw new TransientError("Threads publish returned no post id; check Threads before any resend.");
  return data.id;
}

/** Redact all provider error bodies on the video path, including signed URLs. */
function officialThreadsVideoConfig(config: ThreadsConfig): ThreadsConfig {
  if (!["https://graph.threads.com", "https://graph.threads.net"].includes(config.apiBase)
    || !/^v[0-9]+\.[0-9]+$/.test(config.apiVersion)) {
    throw new PermanentError("Threads video delivery requires the official Meta API endpoint.");
  }
  return config;
}

function safeVideoError(error: unknown, action: string): Error {
  if (isAuthFailure(error)) return new PermanentError("Threads connection expired or was revoked. Reconnect in Settings > Accounts.");
  return error instanceof PermanentError
    ? new PermanentError(`Threads rejected the video ${action}.`)
    : new TransientError(`Threads video ${action} could not be confirmed.`);
}

async function createVideoContainer(
  account: ThreadsAccount, text: string, videoUrl: string, config: ThreadsConfig
): Promise<string> {
  try {
    const body = new URLSearchParams({ media_type: "VIDEO", text, video_url: videoUrl, access_token: account.accessToken });
    const data = await fetchJson<CreateResponse>(endpoint(config, `${account.userId}/threads`), {
      label: "Threads video container", headers: FORM_HEADERS, body, redirect: "error"
    });
    if (typeof data.id !== "string" || !/^[0-9]{1,64}$/.test(data.id)) throw new TransientError();
    return data.id;
  } catch (error) {
    throw safeVideoError(error, "container creation");
  }
}

export async function threadsVideoContainerStatus(
  account: ThreadsAccount, containerId: string, config: ThreadsConfig
): Promise<string> {
  config = officialThreadsVideoConfig(config);
  if (!/^[0-9]{1,64}$/.test(containerId)) throw new PermanentError("Invalid Threads container reference.");
  try {
    const response = await fetchJson<{ status?: string }>(endpoint(config, `${containerId}?fields=status`), {
      label: "Threads video status", method: "GET", redirect: "error", headers: { Authorization: `Bearer ${account.accessToken}` }
    });
    return typeof response.status === "string" ? response.status : "UNKNOWN";
  } catch (error) {
    throw safeVideoError(error, "container readback");
  }
}

function threadsPermalink(value: unknown, username: string, shortcode: unknown): string | null {
  if (typeof value !== "string" || typeof shortcode !== "string" || !/^[\w-]+$/.test(shortcode)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["threads.com", "threads.net", "www.threads.com", "www.threads.net"].includes(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash
      || ![`/@${username}/post/${shortcode}`, `/@${username}/post/${shortcode}/`].includes(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export async function readThreadsVideoPost(
  account: ThreadsAccount, target: ThreadsVideoTarget, postId: string, config: ThreadsConfig
): Promise<{ permalink: string; providerTimestamp: string }> {
  config = officialThreadsVideoConfig(config);
  if (!/^[0-9]{1,64}$/.test(postId)) throw new PermanentError("Invalid Threads post reference.");
  try {
    const profile = await fetchThreadsProfile(account, config, true);
    if (profile.id !== target.userId || profile.username?.toLowerCase() !== target.username.toLowerCase()) throw new PermanentError();
    const data = await fetchJson<{
      id?: string; owner?: { id?: string }; username?: string; permalink?: string; shortcode?: string;
      media_type?: string; text?: string; timestamp?: string;
    }>(endpoint(config, `${postId}?fields=id,owner,username,media_type,text,timestamp,permalink,shortcode`), {
      label: "Threads video post readback", method: "GET", redirect: "error", headers: { Authorization: `Bearer ${account.accessToken}` }
    });
    const postedAt = new Date(data.timestamp ?? "").getTime();
    const permalink = threadsPermalink(data.permalink, target.username, data.shortcode);
    // Minor timestamp skew does not substitute for ID, owner, media type, and full text.
    if (data.id !== postId || data.owner?.id !== target.userId || data.username?.toLowerCase() !== target.username.toLowerCase()
      || data.media_type !== "VIDEO" || data.text !== target.text || !permalink || !Number.isFinite(postedAt)
      || postedAt < new Date(target.publishAt).getTime() - 60_000 || postedAt > new Date(target.latestAt).getTime() + 60_000) {
      throw new PermanentError();
    }
    return { permalink, providerTimestamp: new Date(postedAt).toISOString() };
  } catch (error) {
    throw safeVideoError(error, "post readback");
  }
}

export type ThreadsPublishResult = { containerId: string; postId: string };

export type ThreadsPublishInput = {
  account: ThreadsAccount;
  text: string;
  containerId?: string;
  replyToId?: string;
  attributionCode?: string;
  video?: { target: ThreadsVideoTarget; stage: () => Promise<string> };
  /** Persist a fresh handle before a publish call can put it on the feed. */
  onContainerCreated?: (containerId: string) => Promise<void>;
  /** Save a durable uncertain-send guard BEFORE the publish request. */
  onBeforePublish?: (containerId: string) => Promise<void>;
  /** Re-check pause/settings after network waits. */
  shouldPublish?: () => Promise<boolean>;
};

/**
 * Posts one piece of text as one account and returns the ids.
 *
 * `containerId` may be passed back in from a previous attempt that created a
 * container but died before publishing it — re-using it is what keeps a retry
 * from leaving an orphan behind. The publish call is made once. A missing receipt leaves the
 * durable send guard in place until a person reconciles it with Threads.
 */
export async function postToThreads(
  input: ThreadsPublishInput,
  config: ThreadsConfig = threadsConfig()
): Promise<ThreadsPublishResult> {
  if (input.video) config = officialThreadsVideoConfig(config);
  const checkControl = async (containerId?: string) => {
    if (input.shouldPublish && !await input.shouldPublish()) throw new ThreadsPublishPausedError(containerId);
  };
  await checkControl(input.containerId);
  // Resolve once, then check again: a token lookup can wait on the network
  // while the user turns the automation off.
  let userId: string;
  if (input.video) {
    try {
      const profile = await fetchThreadsProfile(input.account, config, true);
      if (profile.id !== input.video.target.userId || profile.username?.toLowerCase() !== input.video.target.username.toLowerCase()) {
        throw new PermanentError("Threads destination profile changed. Reconnect the intended account.");
      }
      userId = profile.id;
    } catch (error) {
      throw safeVideoError(error, "destination check");
    }
  } else {
    userId = await accountUserId(input.account, config);
  }
  const account = { ...input.account, userId };
  await checkControl(input.containerId);
  let containerId = input.containerId;
  if (!containerId) {
    if (input.video) {
      const url = await input.video.stage();
      await checkControl();
      containerId = await createVideoContainer(account, input.text, url, config);
    } else {
      containerId = await createTextContainer(account, input.text, config, input.replyToId, input.attributionCode);
    }
    await input.onContainerCreated?.(containerId);
  }
  if (input.video) {
    const status = await threadsVideoContainerStatus(account, containerId, config);
    if (status === "PUBLISHED") throw new ContainerPendingError(containerId, "Threads reports this container was already published. Check its receipt.");
    if (status === "ERROR" || status === "EXPIRED") throw new PermanentError("Threads could not process this video container.");
    if (status !== "FINISHED") throw new ThreadsVideoProcessingError("Threads is still processing the video container.");
  }

  await checkControl(containerId);
  await input.onBeforePublish?.(containerId);
  await checkControl(containerId);
  try {
    const postId = await publishContainer(account, containerId, config, Boolean(input.video));
    if (input.video && !/^[0-9]{1,64}$/.test(postId)) throw new TransientError();
    return { containerId, postId };
  } catch (rawError) {
    const error = input.video ? safeVideoError(rawError, "publish") : rawError;
    if (error instanceof PermanentError) {
      throw new ContainerRejectedError(containerId, error.message);
    }
    // Never replay threads_publish after a lost response, timeout, 5xx or
    // unreadable success: the first request may already be on the feed.
    throw new ContainerPendingError(containerId,
      `Threads publish outcome is unknown; check Threads before any resend: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The profile a token belongs to — used by the connection check. */
export async function fetchThreadsProfile(
  account: ThreadsAccount,
  config: ThreadsConfig = threadsConfig(),
  blockRedirects = false
): Promise<{ id: string; username: string | null }> {
  const data = await fetchJson<ProfileResponse>(endpoint(config, "me?fields=id,username"), {
    label: `Threads profile (${account.label})`,
    method: "GET",
    ...(blockRedirects ? { redirect: "error" } : {}),
    headers: { Authorization: `Bearer ${account.accessToken}` }
  });
  if (!data.id) throw new PermanentError("Threads returned no profile id for this token.");
  return { id: data.id, username: data.username ?? null };
}

/** Exercises one account's token without posting anything. */
export async function validateThreadsAuth(
  account: ThreadsAccount,
  config: ThreadsConfig = threadsConfig()
): Promise<{ id: string; username: string | null }> {
  const profile = await fetchThreadsProfile(account, config);
  // Only a user id given by hand can disagree with the token; a resolved one
  // came from the token in the first place.
  if (account.userId && profile.id !== account.userId) {
    throw new PermanentError(
      `The ${account.label} token belongs to Threads user ${profile.id}${
        profile.username ? ` (@${profile.username})` : ""
      }, but its configured user id is ${account.userId}. Fix whichever is wrong before posting.`
    );
  }
  return profile;
}

export type ThreadsAccountCheck = {
  accountId: string;
  label: string;
  posts: string;
  ok: boolean;
  username?: string | null;
  error?: string;
};

/** Checks every connected account, reporting each rather than failing on the first. */
export async function checkAllAccounts(config: ThreadsConfig = threadsConfig()): Promise<ThreadsAccountCheck[]> {
  return Promise.all(
    config.accounts.map(async (account): Promise<ThreadsAccountCheck> => {
      const base = { accountId: account.id, label: account.label, posts: account.posts };
      try {
        const profile = await validateThreadsAuth(account, config);
        return { ...base, ok: true, username: profile.username };
      } catch (error) {
        return { ...base, ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    })
  );
}
