/**
 * Threads autopilot configuration. Everything comes from environment variables
 * (.env locally) so no token is ever committed.
 *
 * The switch is on by default because it is inert without credentials: with no
 * THREADS_USER_ID / THREADS_ACCESS_TOKEN nothing is planned and nothing is
 * posted. Pasting those two values is the whole setup.
 */

export type ThreadsSecondPostMode = "reply" | "standalone" | "off";

export type ThreadsConfig = {
  /** Master switch. Inert without credentials, so it defaults to on. */
  enabled: boolean;
  /** The Threads profile's numeric user id (not the handle). */
  userId: string | null;
  /** Long-lived Threads access token with threads_basic + threads_content_publish. */
  accessToken: string | null;
  apiBase: string;
  apiVersion: string;
  /** All slot times are wall-clock times in this zone. */
  timezone: string;
  /** How many of the pack's posts to schedule per day. */
  postsPerDay: number;
  /**
   * What to do with the second version of each idea:
   *   "reply"      → posted as a reply under the main post, making each slot a
   *                  real two-post thread (default — a reworded near-duplicate
   *                  sitting alone in the feed reads as spam);
   *   "standalone" → its own top-level post, `secondPostGapMinutes` later;
   *   "off"        → only the main post goes out.
   */
  secondPost: ThreadsSecondPostMode;
  secondPostGapMinutes: number;
  /**
   * How late a post may still fire. Past that it is skipped rather than
   * published, so a machine that was off all morning never dumps a backlog
   * into the feed the moment it wakes up.
   */
  lateGraceMinutes: number;
  maxAttempts: number;
  /** First retry delay; doubles per attempt, capped at backoffCapMinutes. */
  backoffBaseMinutes: number;
  backoffCapMinutes: number;
  /** An item claimed longer ago than this is treated as abandoned and retried. */
  claimTimeoutMinutes: number;
  /** Batches older than this are dropped from the queue file. */
  retentionDays: number;
};

/** Threads rejects anything longer than this; posts are fitted to it. */
export const THREADS_TEXT_LIMIT = 500;

function flag(name: string, fallback = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function str(name: string): string | null {
  const raw = process.env[name]?.trim();
  return raw ? raw : null;
}

function num(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function secondPostMode(): ThreadsSecondPostMode {
  const raw = str("THREADS_SECOND_POST")?.toLowerCase();
  if (raw === "standalone" || raw === "off") return raw;
  return "reply";
}

export function threadsConfig(): ThreadsConfig {
  return {
    enabled: flag("THREADS_ENABLED", true),
    userId: str("THREADS_USER_ID"),
    accessToken: str("THREADS_ACCESS_TOKEN"),
    // VERIFY: Threads keeps its own Graph host and version line, separate from
    // the Facebook/Instagram one — https://developers.facebook.com/docs/threads
    apiBase: (str("THREADS_API_BASE") ?? "https://graph.threads.net").replace(/\/+$/, ""),
    apiVersion: str("THREADS_GRAPH_API_VERSION") ?? "v1.0",
    timezone: str("THREADS_TIMEZONE") ?? str("PUBLISH_TIMEZONE") ?? "America/Toronto",
    postsPerDay: Math.min(48, num("THREADS_POSTS_PER_DAY", 24)),
    secondPost: secondPostMode(),
    secondPostGapMinutes: num("THREADS_SECOND_POST_GAP_MINUTES", 3),
    lateGraceMinutes: num("THREADS_LATE_GRACE_MINUTES", 45),
    maxAttempts: num("THREADS_MAX_ATTEMPTS", 4),
    backoffBaseMinutes: num("THREADS_BACKOFF_BASE_MINUTES", 5),
    backoffCapMinutes: num("THREADS_BACKOFF_CAP_MINUTES", 60),
    claimTimeoutMinutes: num("THREADS_CLAIM_TIMEOUT_MINUTES", 10),
    retentionDays: num("THREADS_RETENTION_DAYS", 14)
  };
}

/** True when the autopilot can actually post: switched on and connected. */
export function threadsConfigured(config: ThreadsConfig = threadsConfig()): boolean {
  return Boolean(config.enabled && config.userId && config.accessToken);
}

/** Why the autopilot is idle, or null when it is ready to run. */
export function threadsBlockedReason(config: ThreadsConfig = threadsConfig()): string | null {
  if (!config.enabled) return "The Threads autopilot is switched off (THREADS_ENABLED=false).";
  if (!config.userId || !config.accessToken) {
    return "Threads is not connected — set THREADS_USER_ID and THREADS_ACCESS_TOKEN in .env.";
  }
  return null;
}
