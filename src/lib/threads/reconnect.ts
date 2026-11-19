import { threadsAccountFingerprint } from "@/lib/platform-health/fingerprint";
import { readAuthStates } from "@/lib/platform-health/store";
import { authStateKey } from "@/lib/platform-health/types";
import { findAccount, threadsConfig, type ThreadsAccount, type ThreadsConfig } from "@/lib/threads/config";

const MESSAGES = {
  threads_reauth_required: "Meta rejected the Threads token. Reauthorize the existing account in Meta and use its new long-lived token.",
  threads_profile_mismatch: "The Threads token belongs to a different profile. Use the account already bound to this queue.",
  threads_publish_permission: "Meta refused the publishing quota check. Verify the existing app's Threads publishing permission in Meta.",
  threads_identity_required: "Enter the exact Threads handle or numeric user ID for this account.",
  threads_probe_unavailable: "Meta did not confirm the Threads connection. Keep delivery paused while checking the connection again."
} as const;

export class ThreadsConnectionError extends Error {
  constructor(readonly code: keyof typeof MESSAGES) {
    super(MESSAGES[code]);
  }
}

type ExpectedProfile = { userId?: string | null; username?: string | null };
type VerifiedProfile = { userId: string; username: string; quotaUsage: number };
export type ThreadsConnectionHealth =
  | { state: "unconfigured" | "unverified" | "reauth_required" }
  | { state: "verified"; username: string; userId: string; checkedAt: string }
  | { state: "check_failed"; code: ThreadsConnectionError["code"] };

function threadsHandle(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

async function readMeta<T>(path: string, account: ThreadsAccount, config: ThreadsConfig): Promise<T> {
  // A replacement bearer is only sent to Meta. Refuse redirects and custom hosts
  // even where the legacy text implementation has an operator-set API base.
  if (!["https://graph.threads.net", "https://graph.threads.com"].includes(config.apiBase) ||
      !/^v\d+\.\d+$/.test(config.apiVersion)) {
    throw new ThreadsConnectionError("threads_probe_unavailable");
  }
  let response: Response;
  try {
    response = await fetch(`https://graph.threads.com/${config.apiVersion}/${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${account.accessToken}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5_000)
    });
  } catch {
    throw new ThreadsConnectionError("threads_probe_unavailable");
  }
  const payload = await response.json().catch(() => null) as { error?: { code?: unknown } } | null;
  const code = payload?.error?.code;
  if (response.status === 401 || code === 190) throw new ThreadsConnectionError("threads_reauth_required");
  if (path.startsWith("me/threads_publishing_limit") && (response.status === 403 || code === 10 || code === 200)) {
    throw new ThreadsConnectionError("threads_publish_permission");
  }
  if (!response.ok || !payload || typeof payload !== "object" || payload.error) {
    throw new ThreadsConnectionError("threads_probe_unavailable");
  }
  return payload as T;
}

/**
 * Verify the account and Meta's read-only publishing quota without creating a
 * container, refreshing a token, or granting access. This is a point-in-time
 * connection check, not proof of a published post or remaining slot capacity.
 * https://developers.facebook.com/documentation/threads/reference/user
 */
export async function verifyThreadsPublishingConnection(
  account: ThreadsAccount,
  config: ThreadsConfig,
  expected: ExpectedProfile
): Promise<VerifiedProfile> {
  const userId = expected.userId?.trim();
  const username = expected.username && threadsHandle(expected.username);
  if ((!userId && !username) || (userId && !/^\d+$/.test(userId)) ||
      (username && !/^[a-z0-9_.]{1,30}$/.test(username))) {
    throw new ThreadsConnectionError("threads_identity_required");
  }
  const profile = await readMeta<{ id?: unknown; username?: unknown }>("me?fields=id,username", account, config);
  if (typeof profile.id !== "string" || !/^\d+$/.test(profile.id) ||
      typeof profile.username !== "string" || !/^[a-z0-9_.]{1,30}$/.test(threadsHandle(profile.username))) {
    throw new ThreadsConnectionError("threads_probe_unavailable");
  }
  const verifiedName = threadsHandle(profile.username);
  if ((userId && profile.id !== userId) || (username && verifiedName !== username) ||
      (account.userId && profile.id !== account.userId)) {
    throw new ThreadsConnectionError("threads_profile_mismatch");
  }
  const quota = await readMeta<{ data?: Array<{ quota_usage?: number }> }>(
    "me/threads_publishing_limit?fields=quota_usage", account, config
  );
  const used = Array.isArray(quota.data) ? quota.data[0]?.quota_usage : undefined;
  if (typeof used !== "number" || !Number.isSafeInteger(used) || used < 0) {
    throw new ThreadsConnectionError("threads_probe_unavailable");
  }
  return { userId: profile.id, username: verifiedName, quotaUsage: used };
}

/** GET account settings uses existing failure evidence and makes no provider calls. */
export async function savedThreadsConnectionHealth(
  config: ThreadsConfig = threadsConfig()
): Promise<ThreadsConnectionHealth> {
  const account = findAccount(config, "primary");
  if (!account) return { state: "unconfigured" };
  const lastFailure = (await readAuthStates())[authStateKey("threads", account.id)];
  return lastFailure && lastFailure.fingerprint === threadsAccountFingerprint(account)
    ? { state: "reauth_required" }
    : { state: "unverified" };
}
