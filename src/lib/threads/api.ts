import { PermanentError, TransientError, fetchJson, fetchRaw } from "@/lib/publisher/http";
import { attributeLinks } from "@/lib/publisher/attribution";
import { THREADS_TEXT_LIMIT, threadsConfig, type ThreadsAccount, type ThreadsConfig } from "@/lib/threads/config";

/**
 * Meta's Threads Graph API: text posts, and text with a video, a picture or a
 * carousel of pictures.
 *
 * Publishing is two calls: create a container, then publish that container. A
 * media container is polled until Threads says FINISHED before it is published. Every call is made as one specific account, so the two connected
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
  config: ThreadsConfig = threadsConfig()
): Promise<string> {
  const body = new URLSearchParams({ creation_id: creationId, access_token: account.accessToken });
  const userId = await accountUserId(account, config);

  // A successful HTTP response without a readable receipt is still an
  // uncertain send. Only an explicit rejection can prove nothing went live.
  const response = await fetchRaw(endpoint(config, `${encodeURIComponent(userId)}/threads_publish`), {
    label: `Threads publish (${account.label})`,
    headers: FORM_HEADERS,
    body,
    timeoutMs: 20_000
  });
  const data = await response.json() as PublishResponse;
  if (typeof data.id !== "string" || !data.id.trim()) throw new TransientError("Threads publish returned no post id; check Threads before any resend.");
  return data.id;
}

export type ThreadsMediaUrls = { kind: "video" | "image" | "carousel"; urls: string[] };

export const THREADS_CAROUSEL_MAX = 20;

async function createContainer(account: ThreadsAccount, fields: Record<string, string>, config: ThreadsConfig, label: string): Promise<string> {
  const userId = await accountUserId(account, config);
  const data = await fetchJson<CreateResponse>(endpoint(config, `${encodeURIComponent(userId)}/threads`), {
    label: `${label} (${account.label})`,
    headers: FORM_HEADERS,
    body: new URLSearchParams({ ...fields, access_token: account.accessToken })
  });
  if (!data.id) throw new PermanentError(`${label} returned no container id.`);
  return data.id;
}

/** Creates the container for text with media. A carousel makes its child containers first. */
export async function createMediaContainer(
  account: ThreadsAccount,
  text: string,
  media: ThreadsMediaUrls,
  config: ThreadsConfig = threadsConfig(),
  attributionCode?: string
): Promise<string> {
  const caption = textWithinLimit(text, attributionCode);
  if (media.urls.length === 0) throw new PermanentError("This Threads post has no media link to send.");
  if (media.kind === "video") return createContainer(account, { media_type: "VIDEO", video_url: media.urls[0], text: caption }, config, "Threads video container");
  if (media.kind === "image" || media.urls.length === 1) return createContainer(account, { media_type: "IMAGE", image_url: media.urls[0], text: caption }, config, "Threads image container");
  if (media.urls.length > THREADS_CAROUSEL_MAX) throw new PermanentError(`Threads carousels hold at most ${THREADS_CAROUSEL_MAX} pictures; this post has ${media.urls.length}.`);
  const children: string[] = [];
  for (const url of media.urls) {
    children.push(await createContainer(account, { media_type: "IMAGE", image_url: url, is_carousel_item: "true" }, config, "Threads carousel picture"));
  }
  return createContainer(account, { media_type: "CAROUSEL", children: children.join(","), text: caption }, config, "Threads carousel container");
}

export class StillProcessingError extends TransientError {}

type StatusResponse = { status?: string; error_message?: string };

/** Waits for Threads to finish fetching and processing a media container. */
export async function waitForContainer(
  account: ThreadsAccount,
  containerId: string,
  config: ThreadsConfig = threadsConfig(),
  options: { polls?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<void> {
  const polls = options.polls ?? 18;
  const delayMs = options.delayMs ?? 10_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let poll = 0; poll < polls; poll += 1) {
    const data = await fetchJson<StatusResponse>(endpoint(config, `${encodeURIComponent(containerId)}?fields=status,error_message`), {
      label: `Threads container status (${account.label})`,
      method: "GET",
      headers: { Authorization: `Bearer ${account.accessToken}` }
    });
    const status = (data.status ?? "").toUpperCase();
    if (status === "FINISHED" || status === "PUBLISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new ContainerRejectedError(containerId, `Threads could not process the media (${status.toLowerCase()}${data.error_message ? `: ${data.error_message}` : ""}).`);
    }
    if (poll < polls - 1) await sleep(delayMs);
  }
  throw new StillProcessingError("Threads is still processing the media; it will be published on the next try.");
}

export type ThreadsPublishResult = { containerId: string; postId: string };

export type ThreadsPublishInput = {
  account: ThreadsAccount;
  text: string;
  containerId?: string;
  replyToId?: string;
  attributionCode?: string;
  /** Media sent with the text, as links Threads can fetch. */
  media?: ThreadsMediaUrls;
  /** Override the processing poll (tests). */
  mediaPoll?: { polls?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> };
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
  const checkControl = async (containerId?: string) => {
    if (input.shouldPublish && !await input.shouldPublish()) throw new ThreadsPublishPausedError(containerId);
  };
  await checkControl(input.containerId);
  // Resolve once, then check again: a token lookup can wait on the network
  // while the user turns the automation off.
  const account = { ...input.account, userId: await accountUserId(input.account, config) };
  await checkControl(input.containerId);
  const containerId = input.containerId ?? (input.media
    ? await createMediaContainer(account, input.text, input.media, config, input.attributionCode)
    : await createTextContainer(account, input.text, config, input.replyToId, input.attributionCode));
  if (!input.containerId) await input.onContainerCreated?.(containerId);
  if (input.media) await waitForContainer(account, containerId, config, input.mediaPoll);

  await checkControl(containerId);
  await input.onBeforePublish?.(containerId);
  await checkControl(containerId);
  try {
    return { containerId, postId: await publishContainer(account, containerId, config) };
  } catch (error) {
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
  config: ThreadsConfig = threadsConfig()
): Promise<{ id: string; username: string | null }> {
  const data = await fetchJson<ProfileResponse>(endpoint(config, "me?fields=id,username"), {
    label: `Threads profile (${account.label})`,
    method: "GET",
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
