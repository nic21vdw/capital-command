import { PermanentError, TransientError, fetchJson } from "@/lib/publisher/http";
import { threadsConfig, type ThreadsAccount, type ThreadsConfig } from "@/lib/threads/config";

/**
 * Meta's Threads Graph API — text posts only.
 *
 * Publishing is two calls: create a container for the text, then publish that
 * container. Every call is made as one specific account, so the two connected
 * profiles never share credentials.
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

/** Creates the text container. Returns its creation id. */
export async function createTextContainer(
  account: ThreadsAccount,
  text: string,
  config: ThreadsConfig = threadsConfig()
): Promise<string> {
  const body = new URLSearchParams({ media_type: "TEXT", text, access_token: account.accessToken });
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

  const data = await fetchJson<PublishResponse>(endpoint(config, `${encodeURIComponent(userId)}/threads_publish`), {
    label: `Threads publish (${account.label})`,
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
 * Posts one piece of text as one account and returns the ids.
 *
 * `containerId` may be passed back in from a previous attempt that created a
 * container but died before publishing it — re-using it is what keeps a retry
 * from leaving an orphan behind. Meta needs a moment to process a fresh
 * container, so publishing is retried briefly before the failure is handed to
 * the runner's own backoff.
 */
export async function postToThreads(
  input: { account: ThreadsAccount; text: string; containerId?: string },
  config: ThreadsConfig = threadsConfig()
): Promise<ThreadsPublishResult> {
  const { account } = input;
  const containerId = input.containerId ?? (await createTextContainer(account, input.text, config));

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await sleep(5_000);
    try {
      return { containerId, postId: await publishContainer(account, containerId, config) };
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
