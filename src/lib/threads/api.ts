import { PermanentError, TransientError, fetchJson } from "@/lib/publisher/http";
import { threadsConfig, type ThreadsConfig } from "@/lib/threads/config";

/**
 * Meta's Threads Graph API — text posts only.
 *
 * Publishing is two calls: create a container for the text, then publish that
 * container. A reply is the same pair with `reply_to_id` set to the media id of
 * the post being replied to, which is how a slot becomes a real two-post
 * thread rather than two near-duplicate posts in the feed.
 *
 * The access token travels in the request body or an Authorization header,
 * never in the URL, so it cannot end up in a log line or an error message.
 */

/**
 * Thrown when the container exists but has not gone live yet. Carries the
 * container id so the next attempt resumes instead of creating a second
 * container for the same post.
 */
export class ContainerPendingError extends TransientError {
  constructor(
    readonly containerId: string,
    message: string
  ) {
    super(message);
  }
}

type CreateResponse = { id?: string };
type PublishResponse = { id?: string };
type ProfileResponse = { id?: string; username?: string };

function credentials(config: ThreadsConfig): { userId: string; token: string } {
  if (!config.userId || !config.accessToken) {
    throw new PermanentError(
      'Threads is not connected. Set THREADS_USER_ID and THREADS_ACCESS_TOKEN in .env (see README, "Threads autopilot").'
    );
  }
  return { userId: config.userId, token: config.accessToken };
}

function endpoint(config: ThreadsConfig, path: string): string {
  return `${config.apiBase}/${config.apiVersion}/${path}`;
}

const FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded" };

/** Creates the text container. Returns its creation id. */
export async function createTextContainer(
  input: { text: string; replyToId?: string },
  config: ThreadsConfig = threadsConfig()
): Promise<string> {
  const { userId, token } = credentials(config);
  const body = new URLSearchParams({ media_type: "TEXT", text: input.text, access_token: token });
  if (input.replyToId) body.set("reply_to_id", input.replyToId);

  const data = await fetchJson<CreateResponse>(endpoint(config, `${encodeURIComponent(userId)}/threads`), {
    label: "Threads container create",
    headers: FORM_HEADERS,
    body
  });
  if (!data.id) throw new PermanentError("Threads accepted the text but returned no container id.");
  return data.id;
}

/** Publishes a previously created container. Returns the live post's media id. */
export async function publishContainer(
  creationId: string,
  config: ThreadsConfig = threadsConfig()
): Promise<string> {
  const { userId, token } = credentials(config);
  const body = new URLSearchParams({ creation_id: creationId, access_token: token });

  const data = await fetchJson<PublishResponse>(endpoint(config, `${encodeURIComponent(userId)}/threads_publish`), {
    label: "Threads publish",
    headers: FORM_HEADERS,
    body
  });
  if (!data.id) throw new PermanentError("Threads published the container but returned no post id.");
  return data.id;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ThreadsPublishResult = { containerId: string; postId: string };

/**
 * Posts one piece of text and returns the ids.
 *
 * `containerId` may be passed back in from a previous attempt that created a
 * container but died before publishing it — re-using it is what keeps a retry
 * from leaving an orphan behind. Meta needs a moment to process a fresh
 * container, so publishing is retried briefly before the failure is handed to
 * the runner's own backoff.
 */
export async function postToThreads(
  input: { text: string; replyToId?: string; containerId?: string },
  config: ThreadsConfig = threadsConfig()
): Promise<ThreadsPublishResult> {
  const containerId = input.containerId ?? (await createTextContainer(input, config));

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await sleep(5_000);
    try {
      return { containerId, postId: await publishContainer(containerId, config) };
    } catch (error) {
      lastError = error;
    }
  }
  throw new ContainerPendingError(
    containerId,
    `Threads did not publish the container after three attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

/** The connected profile — used by the connection check and the dashboard. */
export async function fetchThreadsProfile(
  config: ThreadsConfig = threadsConfig()
): Promise<{ id: string; username: string | null }> {
  const { token } = credentials(config);
  const data = await fetchJson<ProfileResponse>(endpoint(config, "me?fields=id,username"), {
    label: "Threads profile",
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!data.id) throw new PermanentError("Threads returned no profile id for this token.");
  return { id: data.id, username: data.username ?? null };
}

/** Exercises the token without posting anything. */
export async function validateThreadsAuth(
  config: ThreadsConfig = threadsConfig()
): Promise<{ id: string; username: string | null }> {
  const profile = await fetchThreadsProfile(config);
  const { userId } = credentials(config);
  if (profile.id !== userId) {
    throw new PermanentError(
      `The token belongs to Threads user ${profile.id}${
        profile.username ? ` (@${profile.username})` : ""
      }, but THREADS_USER_ID is ${userId}. Fix whichever is wrong before posting.`
    );
  }
  return profile;
}
