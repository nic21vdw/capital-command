import { MAX_PAGES } from "@/lib/inbox/fetch/common";
import { classifyFailure } from "@/lib/inbox/failures";
import { resolveLane, type Lane, type PostFetcher } from "@/lib/inbox/lanes";
import { listPublishedPosts } from "@/lib/inbox/posts";
import { selectPostsToFetch } from "@/lib/inbox/schedule";
import { mergeIncoming, readInbox, updateInbox } from "@/lib/inbox/store";
import { laterOf } from "@/lib/inbox/time";
import {
  INBOX_PLATFORMS,
  cursorKey,
  reconnectMessage,
  type InboxItem,
  type InboxPlatform,
  type InboxStore,
  type PlatformSyncState,
  type PostCursor,
  type PublishedPost
} from "@/lib/inbox/types";
import { authFailureReason } from "@/lib/platform-health/auth";
import { accountAuthBlocked, clearAuthState, recordAuthRejection } from "@/lib/platform-health/store";
import { dateTimeFormat } from "@/lib/publisher/intl";

export type PlatformStatus = "ok" | "not-connected" | "needs-scope" | "needs-auth" | "throttled" | "deferred" | "error";

export type PlatformReport = {
  status: PlatformStatus;
  fetchedPosts: number;
  added: number;
  detail?: string;
};

export type SyncReport = {
  at: string;
  added: number;
  platforms: Partial<Record<InboxPlatform, PlatformReport>>;
};

export type SyncOptions = {
  now?: Date;
  posts?: PublishedPost[];
  platforms?: InboxPlatform[];
  force?: boolean;
};

const MAX_POSTS_PER_PLATFORM = 40;
const MAX_CONSECUTIVE_ERRORS = 3;
const SCOPE_RECHECK_MS = 6 * 3_600_000;
const CURSOR_RETENTION_MS = 35 * 86_400_000;
const DEFAULT_YOUTUBE_DAILY_UNITS = 200;
const QUOTA_TIMEZONE = "America/Los_Angeles";

const PRIORITY: PlatformStatus[] = ["needs-auth", "needs-scope", "throttled", "error", "deferred", "ok", "not-connected"];

function youtubeDailyUnits(): number {
  const raw = process.env.INBOX_YOUTUBE_DAILY_UNITS?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_YOUTUBE_DAILY_UNITS;
}

function quotaDay(now: Date): string {
  return dateTimeFormat("en-CA", { timeZone: QUOTA_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function unitsUsedToday(store: InboxStore, now: Date): number {
  return store.youtubeUnits?.date === quotaDay(now) ? store.youtubeUnits.used : 0;
}

function shortError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}

type LaneOutcome = {
  report: PlatformReport;
  items: InboxItem[];
  cursors: Record<string, PostCursor>;
  units: number;
  lastError?: string;
};

async function syncLane(
  lane: Lane,
  lanePosts: PublishedPost[],
  store: InboxStore,
  ctx: { now: Date; force: boolean; unitsLeft: number }
): Promise<LaneOutcome> {
  const { now } = ctx;
  const outcome: LaneOutcome = { report: { status: "ok", fetchedPosts: 0, added: 0 }, items: [], cursors: {}, units: 0 };
  const target = { platform: lane.platform, accountId: lane.accountId, accountLabel: lane.label };

  if (await accountAuthBlocked(lane.platform, lane.accountId, lane.fingerprint, now)) {
    outcome.report = { status: "needs-auth", fetchedPosts: 0, added: 0, detail: reconnectMessage(lane.platform, "auth") };
    return outcome;
  }

  const selected = selectPostsToFetch(lanePosts, store.cursors, now, { limit: MAX_POSTS_PER_PLATFORM, force: ctx.force });
  if (selected.length === 0) return outcome;

  const fail = async (error: unknown): Promise<boolean> => {
    const kind = classifyFailure(error);
    if (kind === "auth") {
      await recordAuthRejection(target, error, { now, fingerprint: lane.fingerprint });
      outcome.report.status = "needs-auth";
      outcome.report.detail = reconnectMessage(lane.platform, "auth");
      outcome.lastError = authFailureReason(error);
      return true;
    }
    if (kind === "scope") {
      outcome.report.status = "needs-scope";
      outcome.report.detail = reconnectMessage(lane.platform, "scope");
      outcome.lastError = shortError(error);
      return true;
    }
    if (kind === "throttled") {
      outcome.report.status = "throttled";
      outcome.report.detail = shortError(error);
      return true;
    }
    return false;
  };

  let fetcher: PostFetcher;
  try {
    fetcher = await lane.open();
  } catch (error) {
    if (!(await fail(error))) {
      outcome.report = { status: "error", fetchedPosts: 0, added: 0, detail: shortError(error) };
      outcome.lastError = shortError(error);
    }
    return outcome;
  }

  let consecutiveErrors = 0;
  for (const post of selected) {
    const unitsLeft = lane.platform === "youtube" ? ctx.unitsLeft - outcome.units : Infinity;
    if (unitsLeft <= 0) {
      outcome.report.status = "deferred";
      outcome.report.detail = "Daily YouTube read budget used";
      break;
    }
    const key = cursorKey(post.platform, post.postId);
    const cursor = store.cursors[key] ?? {};
    try {
      const result = await fetcher(post, cursor.newestAt ?? null, { now, maxPages: Math.min(MAX_PAGES, unitsLeft) });
      outcome.units += result.pages;
      outcome.items.push(...result.items);
      outcome.report.fetchedPosts += 1;
      const newestFound = result.items.reduce<string | null>((latest, item) => laterOf(latest, item.at), null);
      outcome.cursors[key] = {
        ...cursor,
        ...(result.newestAt ? { newestAt: laterOf(cursor.newestAt ?? null, result.newestAt) } : {}),
        ...(newestFound ? { lastActivityAt: laterOf(cursor.lastActivityAt ?? null, newestFound) } : {}),
        ...(result.permalink ? { permalink: result.permalink } : {}),
        lastFetchedAt: now.toISOString()
      };
      consecutiveErrors = 0;
    } catch (error) {
      if (await fail(error)) break;
      const kind = classifyFailure(error);
      if (kind === "gone" || kind === "comments-disabled") {
        outcome.cursors[key] = { ...cursor, lastFetchedAt: now.toISOString() };
        continue;
      }
      outcome.lastError = shortError(error);
      consecutiveErrors += 1;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        outcome.report.status = "error";
        outcome.report.detail = shortError(error);
        break;
      }
    }
  }
  return outcome;
}

function mergeCursor(existing: PostCursor | undefined, update: PostCursor): PostCursor {
  const lastActivityAt = [existing?.lastActivityAt, update.lastActivityAt]
    .filter((stamp): stamp is string => Boolean(stamp))
    .reduce<string | null>((latest, stamp) => laterOf(latest, stamp), null);
  return { ...existing, ...update, ...(lastActivityAt ? { lastActivityAt } : {}) };
}

function pruneCursors(cursors: Record<string, PostCursor>, now: Date): Record<string, PostCursor> {
  const cutoff = now.getTime() - CURSOR_RETENTION_MS;
  return Object.fromEntries(
    Object.entries(cursors).filter(([, cursor]) => {
      const last = Math.max(Date.parse(cursor.lastFetchedAt ?? "") || 0, Date.parse(cursor.lastActivityAt ?? "") || 0);
      return last >= cutoff;
    })
  );
}

async function syncPlatform(
  platform: InboxPlatform,
  posts: PublishedPost[],
  ctx: { now: Date; force: boolean }
): Promise<PlatformReport> {
  const { now } = ctx;
  const store = await readInbox();
  const previous = store.platforms[platform];

  if (
    !ctx.force &&
    previous?.needs === "scope" &&
    previous.needsSince &&
    now.getTime() - Date.parse(previous.needsSince) < SCOPE_RECHECK_MS
  ) {
    return { status: "needs-scope", fetchedPosts: 0, added: 0, detail: previous.message };
  }

  const accountIds = [...new Set(posts.map((post) => post.accountId))];
  const outcomes: LaneOutcome[] = [];
  let connectedLanes = 0;
  let unitsLeft = platform === "youtube" ? youtubeDailyUnits() - unitsUsedToday(store, now) : Infinity;

  for (const accountId of accountIds) {
    const lane = await resolveLane(platform, accountId);
    if (!lane) continue;
    connectedLanes += 1;
    const outcome = await syncLane(
      lane,
      posts.filter((post) => post.accountId === accountId),
      store,
      { now, force: ctx.force, unitsLeft }
    );
    unitsLeft -= outcome.units;
    outcomes.push(outcome);
    if (outcome.report.status === "ok" && outcome.report.fetchedPosts > 0) await clearAuthState(platform, accountId);
  }

  if (connectedLanes === 0) {
    await updateInbox((current) => ({
      ...current,
      platforms: { ...current.platforms, [platform]: { connected: false, lastSyncAt: now.toISOString() } }
    }));
    return { status: "not-connected", fetchedPosts: 0, added: 0 };
  }

  const items = outcomes.flatMap((outcome) => outcome.items);
  const worst = outcomes.map((outcome) => outcome.report).sort((a, b) => PRIORITY.indexOf(a.status) - PRIORITY.indexOf(b.status))[0];
  const report: PlatformReport = {
    status: worst.status,
    fetchedPosts: outcomes.reduce((sum, outcome) => sum + outcome.report.fetchedPosts, 0),
    added: 0,
    ...(worst.detail ? { detail: worst.detail } : {})
  };
  const lastError = outcomes.find((outcome) => outcome.lastError)?.lastError;
  const unitsSpent = outcomes.reduce((sum, outcome) => sum + outcome.units, 0);

  await updateInbox((current) => {
    const merged = mergeIncoming(current, items, now);
    const known = new Set(current.items.map((item) => item.id));
    const kept = new Set(merged.items.map((item) => item.id));
    report.added = new Set(items.filter((item) => !known.has(item.id) && kept.has(item.id)).map((item) => item.id)).size;
    const cursors = { ...merged.cursors };
    for (const outcome of outcomes) {
      for (const [key, update] of Object.entries(outcome.cursors)) cursors[key] = mergeCursor(cursors[key], update);
    }
    const problem = worst.status === "needs-scope" || worst.status === "needs-auth";
    const unprobed = worst.status === "ok" && report.fetchedPosts === 0 && previous?.needs !== undefined;
    const state: PlatformSyncState = unprobed
      ? { ...previous, lastSyncAt: now.toISOString() }
      : {
          connected: true,
          lastSyncAt: now.toISOString(),
          ...(lastError ? { lastError } : {}),
          ...(problem
            ? {
                needs: worst.status === "needs-scope" ? ("scope" as const) : ("auth" as const),
                message: worst.detail,
                needsSince: now.toISOString()
              }
            : {})
        };
    return {
      ...merged,
      cursors: pruneCursors(cursors, now),
      platforms: { ...merged.platforms, [platform]: state },
      ...(platform === "youtube"
        ? { youtubeUnits: { date: quotaDay(now), used: unitsUsedToday(current, now) + unitsSpent } }
        : {})
    };
  });
  return report;
}

async function runSync(options: SyncOptions): Promise<SyncReport> {
  const now = options.now ?? new Date();
  const posts = options.posts ?? (await listPublishedPosts());
  const wanted = options.platforms ?? INBOX_PLATFORMS;
  const report: SyncReport = { at: now.toISOString(), added: 0, platforms: {} };

  for (const platform of INBOX_PLATFORMS) {
    if (!wanted.includes(platform)) continue;
    const platformPosts = posts.filter((post) => post.platform === platform);
    if (platformPosts.length === 0) continue;
    const result = await syncPlatform(platform, platformPosts, { now, force: options.force === true });
    report.platforms[platform] = result;
    report.added += result.added;
  }

  await updateInbox((current) => ({ ...current, lastSyncAt: now.toISOString() }));
  return report;
}

type InflightSlot = typeof globalThis & { __inboxSync?: Promise<SyncReport> };

export function syncInbox(options: SyncOptions = {}): Promise<SyncReport> {
  const slot = globalThis as InflightSlot;
  if (slot.__inboxSync) return slot.__inboxSync;
  const run: Promise<SyncReport> = runSync(options).finally(() => {
    if (slot.__inboxSync === run) slot.__inboxSync = undefined;
  });
  slot.__inboxSync = run;
  return run;
}
