/**
 * Threads autopilot configuration. Everything comes from environment variables
 * (.env locally) so no token is ever committed.
 *
 * The switch is on by default because it is inert without credentials: with no
 * account connected nothing is planned and nothing is posted. Pasting a user id
 * and a token is the whole setup.
 *
 * Two accounts, one version of each idea apiece. The daily pack writes every
 * idea twice — a punchier `text` and a warmer `threadsVariant` — precisely so
 * two feeds never read as duplicates, so each account is assigned one of them.
 * Connect only one account and it simply posts its own version.
 */

export type ThreadsVersion = "text" | "variant";

export type ThreadsAccount = {
  /** Stable key stored on every queue item. */
  id: string;
  /** Handle or nickname, for logs and the dashboard. Falls back to the id. */
  label: string;
  /**
   * The Threads profile's numeric user id. Optional: left unset, it is looked
   * up once from the token itself, so connecting an account only ever means
   * pasting the token Meta gives you.
   */
  userId: string | null;
  /** Long-lived token with threads_basic + threads_content_publish. */
  accessToken: string;
  /** Which version of each idea this account posts. */
  posts: ThreadsVersion;
  /**
   * Minutes after the slot time this account posts. Staggering keeps two
   * connected accounts from firing in perfect lockstep every single slot.
   */
  offsetMinutes: number;
};

export type ThreadsConfig = {
  /** Master switch. Inert without credentials, so it defaults to on. */
  enabled: boolean;
  /** Every account with both credentials present, in slot order. */
  accounts: ThreadsAccount[];
  apiBase: string;
  apiVersion: string;
  /** All slot times are wall-clock times in this zone. */
  timezone: string;
  /** How many of the pack's posts to schedule per day, per account. */
  postsPerDay: number;
  /**
   * How late a post may still fire. Past that it is skipped, so a machine that
   * was off all morning never dumps a backlog into the feed on waking.
   */
  lateGraceMinutes: number;
  maxAttempts: number;
  /** First retry delay; doubles per attempt, capped at backoffCapMinutes. */
  backoffCapMinutes: number;
  backoffBaseMinutes: number;
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
  return Number.isFinite(raw) ? raw : fallback;
}

function version(name: string, fallback: ThreadsVersion): ThreadsVersion {
  const raw = str(name)?.toLowerCase();
  if (raw === "text" || raw === "variant") return raw;
  return fallback;
}

/**
 * Account slots. The first uses the unsuffixed variables so a single-account
 * setup reads naturally; the second adds `_2`. An account exists as soon as it
 * has a token — the user id is optional and resolved from the token when it
 * isn't given.
 */
const SLOTS = [
  { id: "primary", suffix: "", defaultPosts: "text" as ThreadsVersion, defaultOffset: 0 },
  { id: "secondary", suffix: "_2", defaultPosts: "variant" as ThreadsVersion, defaultOffset: 3 }
];

function readAccounts(): ThreadsAccount[] {
  const accounts: ThreadsAccount[] = [];
  for (const slot of SLOTS) {
    const accessToken = str(`THREADS_ACCESS_TOKEN${slot.suffix}`);
    if (!accessToken) continue;
    const userId = str(`THREADS_USER_ID${slot.suffix}`);
    accounts.push({
      id: slot.id,
      label: str(`THREADS_LABEL${slot.suffix}`) ?? slot.id,
      userId,
      accessToken,
      posts: version(`THREADS_POSTS${slot.suffix}`, slot.defaultPosts),
      offsetMinutes: Math.max(0, num(`THREADS_OFFSET_MINUTES${slot.suffix}`, slot.defaultOffset))
    });
  }
  return accounts;
}

export function threadsConfig(): ThreadsConfig {
  return {
    enabled: flag("THREADS_ENABLED", true),
    accounts: readAccounts(),
    // VERIFY: Threads keeps its own Graph host and version line, separate from
    // the Facebook/Instagram one — https://developers.facebook.com/docs/threads
    apiBase: (str("THREADS_API_BASE") ?? "https://graph.threads.net").replace(/\/+$/, ""),
    apiVersion: str("THREADS_GRAPH_API_VERSION") ?? "v1.0",
    timezone: str("THREADS_TIMEZONE") ?? str("PUBLISH_TIMEZONE") ?? "America/Toronto",
    postsPerDay: Math.min(48, Math.max(1, num("THREADS_POSTS_PER_DAY", 24))),
    lateGraceMinutes: num("THREADS_LATE_GRACE_MINUTES", 45),
    maxAttempts: num("THREADS_MAX_ATTEMPTS", 4),
    backoffBaseMinutes: num("THREADS_BACKOFF_BASE_MINUTES", 5),
    backoffCapMinutes: num("THREADS_BACKOFF_CAP_MINUTES", 60),
    claimTimeoutMinutes: num("THREADS_CLAIM_TIMEOUT_MINUTES", 10),
    retentionDays: num("THREADS_RETENTION_DAYS", 14)
  };
}

/** True when the autopilot can actually post: switched on with an account. */
export function threadsConfigured(config: ThreadsConfig = threadsConfig()): boolean {
  return Boolean(config.enabled && config.accounts.length > 0);
}

export function findAccount(config: ThreadsConfig, accountId: string): ThreadsAccount | undefined {
  return config.accounts.find((account) => account.id === accountId);
}

/** Why the autopilot is idle, or null when it is ready to run. */
export function threadsBlockedReason(config: ThreadsConfig = threadsConfig()): string | null {
  if (!config.enabled) return "The Threads autopilot is switched off (THREADS_ENABLED=false).";
  if (config.accounts.length === 0) {
    return "No Threads account is connected — paste a token into THREADS_ACCESS_TOKEN in .env.";
  }
  return null;
}

/**
 * Account slots that were started and left unusable: some setting filled in
 * (a label, a user id, a version) but no token, so nothing can post.
 */
export function unfinishedAccountSlots(): string[] {
  return SLOTS.filter((slot) => {
    if (str(`THREADS_ACCESS_TOKEN${slot.suffix}`)) return false;
    return Boolean(
      str(`THREADS_USER_ID${slot.suffix}`) ||
        str(`THREADS_LABEL${slot.suffix}`) ||
        str(`THREADS_POSTS${slot.suffix}`)
    );
  }).map((slot) => slot.id);
}

/**
 * Versions the pack writes that no connected account is posting — but only
 * when a second account slot was started and abandoned. Running one account on
 * purpose leaves the other version unused by design (post it to X by hand, or
 * don't), and nagging about that on every single tick is just noise.
 */
export function unassignedVersions(config: ThreadsConfig = threadsConfig()): ThreadsVersion[] {
  if (unfinishedAccountSlots().length === 0) return [];
  const covered = new Set(config.accounts.map((account) => account.posts));
  return (["text", "variant"] as ThreadsVersion[]).filter((entry) => !covered.has(entry));
}
