import { liveCredentials } from "@/lib/analytics/credentials";
import { facebookNodeOf, fetchFacebookMetrics } from "@/lib/analytics/facebook";
import { failureMessage, type HttpDeps } from "@/lib/analytics/http";
import { fetchInstagramMetrics } from "@/lib/analytics/instagram";
import { dueForSync, newPostRecord, recordSnapshot } from "@/lib/analytics/metrics";
import { newOutcome, stopFromError, type FetchOutcome, type Stop } from "@/lib/analytics/outcome";
import { DEFAULT_META_CALLS_PER_RUN, createPacer } from "@/lib/analytics/pacing";
import { readMetrics, updateMetrics } from "@/lib/analytics/store";
import { loadTargets } from "@/lib/analytics/targets";
import { fetchThreadsMetrics } from "@/lib/analytics/threads";
import { fetchTiktokMetrics, isTiktokVideoId, tiktokSupport, type TiktokSupport } from "@/lib/analytics/tiktok";
import {
  ANALYTICS_PLATFORMS,
  accountKey,
  postKey,
  type AccountSync,
  type AccountSyncStatus,
  type AnalyticsPlatform,
  type AnalyticsStore,
  type PostRecord,
  type SyncMeta,
  type SyncResult,
  type Target
} from "@/lib/analytics/types";
import { fetchYoutubeMetrics } from "@/lib/analytics/youtube";
import { authFailureReason } from "@/lib/platform-health/auth";
import { accountAuthBlocked, clearAuthState, readAuthStates, recordAuthFailure } from "@/lib/platform-health/store";
import { processAlive } from "@/lib/storage/file-lock";
import { youtubeQuotaLedger, type QuotaLedger } from "@/lib/youtube/quotaLedger";

export type AnalyticsCredentials = {
  youtube(accountId: string): Promise<{ token: string } | null>;
  instagram(accountId: string): Promise<{ token: string; graphBase: string } | null>;
  facebook(accountId: string): Promise<{ token: string; graphBase: string } | null>;
  threads(accountId: string): Promise<{ token: string; base: string } | null>;
  tiktok(accountId: string): Promise<{ token: string } | null>;
  tiktokScopes(): string;
  fingerprint(platform: AnalyticsPlatform, accountId: string): Promise<string | null>;
  label(platform: AnalyticsPlatform, accountId: string): Promise<string | null>;
};

export type SyncDeps = {
  now: () => Date;
  http: HttpDeps;
  credentials: AnalyticsCredentials;
  loadTargets: () => Promise<Target[]>;
  quota: Pick<QuotaLedger, "debit" | "nextResetAt">;
  heartbeatMs?: number;
};

export type AccountOutcome = {
  key: string;
  platform: AnalyticsPlatform;
  accountId: string;
  status: AccountSyncStatus;
  fetched: number;
  note: string | null;
};

export type SyncReport = {
  status: SyncResult | "busy";
  startedAt: string;
  finishedAt: string;
  considered: number;
  fetched: number;
  accounts: AccountOutcome[];
};

export type SyncOptions = {
  force?: boolean;
  manual?: boolean;
  deps?: Partial<SyncDeps>;
};

export const MARKER_STALE_MS = 30 * 60_000;
export const HEARTBEAT_MS = 5 * 60_000;
export const MANUAL_COOLDOWN_MS = 10 * 60_000;
export const MAX_POSTS_PER_ACCOUNT_RUN = 300;
export const GONE_AFTER_MISSES = 3;

const DEFAULT_RATE_WAIT_MS = 60 * 60_000;
const PLATFORM_ORDER = new Map(ANALYTICS_PLATFORMS.map((platform, index) => [platform, index]));
const INBOX_NOTE = "TikTok has not given this post a video id yet; it is still a draft in the creator's inbox.";

export function markerIsLive(running: SyncMeta["running"], now: Date): boolean {
  if (!running) return false;
  const lastSeen = Date.parse(running.heartbeatAt ?? running.startedAt);
  if (!Number.isFinite(lastSeen) || now.getTime() - lastSeen >= MARKER_STALE_MS) return false;
  return processAlive(running.pid);
}

export async function manualCooldownMs(now: Date): Promise<number> {
  const used = (await readMetrics()).sync.lastManualAt;
  const at = used ? Date.parse(used) : NaN;
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, MANUAL_COOLDOWN_MS - (now.getTime() - at));
}

type Flight = { promise: Promise<SyncReport> };
const shared = globalThis as typeof globalThis & { __analyticsSyncFlight?: Flight };

export function syncInFlight(): Promise<SyncReport> | null {
  return shared.__analyticsSyncFlight?.promise ?? null;
}

export function requestSync(options: SyncOptions = {}): { started: boolean; promise: Promise<SyncReport> } {
  const existing = shared.__analyticsSyncFlight;
  if (existing) return { started: false, promise: existing.promise };
  const flight = {} as Flight;
  shared.__analyticsSyncFlight = flight;
  flight.promise = runSync(options).finally(() => {
    if (shared.__analyticsSyncFlight === flight) shared.__analyticsSyncFlight = undefined;
  });
  return { started: true, promise: flight.promise };
}

export function syncAnalytics(options: SyncOptions = {}): Promise<SyncReport> {
  return requestSync(options).promise;
}

function resolveDeps(partial: Partial<SyncDeps> = {}): SyncDeps {
  return {
    now: partial.now ?? (() => new Date()),
    http: partial.http ?? {},
    credentials: partial.credentials ?? liveCredentials(),
    loadTargets: partial.loadTargets ?? loadTargets,
    quota: partial.quota ?? youtubeQuotaLedger,
    heartbeatMs: partial.heartbeatMs
  };
}

async function runSync(options: SyncOptions): Promise<SyncReport> {
  const deps = resolveDeps(options.deps);
  const startedAt = deps.now();
  const report: SyncReport = {
    status: "ok",
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    considered: 0,
    fetched: 0,
    accounts: []
  };

  try {
    const claimed = await updateMetrics((store) => {
      const other = store.sync.running && store.sync.running.pid !== process.pid ? store.sync.running : null;
      if (markerIsLive(other, startedAt)) return false;
      store.sync.running = { pid: process.pid, startedAt: startedAt.toISOString(), heartbeatAt: startedAt.toISOString() };
      store.sync.lastAttemptAt = startedAt.toISOString();
      if (options.manual) store.sync.lastManualAt = startedAt.toISOString();
      return true;
    });
    if (!claimed) return { ...report, status: "busy" };
  } catch {
    return { ...report, status: "error" };
  }

  let lastBeat: Promise<unknown> = Promise.resolve();
  const beat = setInterval(() => {
    lastBeat = updateMetrics((store) => {
      if (store.sync.running?.pid === process.pid) store.sync.running.heartbeatAt = deps.now().toISOString();
    }).catch(() => undefined);
  }, deps.heartbeatMs ?? HEARTBEAT_MS);
  beat.unref?.();

  try {
    await execute(options, deps, report, startedAt);
  } catch (error) {
    report.status = "error";
    report.finishedAt = deps.now().toISOString();
    await updateMetrics((store) => {
      store.sync.running = null;
      store.sync.lastResult = "error";
      store.sync.lastError = failureMessage(error);
    }).catch(() => undefined);
  } finally {
    clearInterval(beat);
    await lastBeat;
  }
  return report;
}

function mergeTarget(existing: PostRecord | undefined, target: Target): PostRecord {
  const record: PostRecord = existing
    ? {
        ...existing,
        accountId: target.accountId,
        itemId: target.itemId,
        format: target.format,
        title: target.title,
        caption: target.caption,
        publishedAt: target.publishedAt
      }
    : newPostRecord(target);
  if (target.carouselId) record.carouselId = target.carouselId;
  if (target.visibility) record.visibility = target.visibility;
  return record;
}

function applyTiktokSupport(record: PostRecord, support: TiktokSupport): void {
  if (!support.supported) {
    record.status = "unsupported";
    record.note = support.reason;
  } else if (!isTiktokVideoId(record.postId)) {
    record.status = "unsupported";
    record.note = INBOX_NOTE;
  } else if (record.status === "unsupported") {
    record.status = "ok";
    delete record.note;
  }
}

async function execute(options: SyncOptions, deps: SyncDeps, report: SyncReport, now: Date): Promise<void> {
  const targets = await deps.loadTargets();
  const support = tiktokSupport(deps.credentials.tiktokScopes());

  await updateMetrics((store) => {
    for (const target of targets) {
      const key = postKey(target.platform, target.postId);
      const record = mergeTarget(store.posts[key], target);
      if (target.platform === "tiktok") applyTiktokSupport(record, support);
      store.posts[key] = record;
    }
  });

  const snapshot = await readMetrics();
  const due = targets.filter((target) => dueForSync(snapshot.posts[postKey(target.platform, target.postId)], now, { force: options.force }));
  report.considered = due.length;

  if (!support.supported) {
    const tiktokAccounts = [...new Set(targets.filter((target) => target.platform === "tiktok").map((target) => target.accountId))];
    for (const accountId of tiktokAccounts) {
      const label = await deps.credentials.label("tiktok", accountId).catch(() => null);
      report.accounts.push(await recorder("tiktok", accountId, label, now)("unsupported", { note: support.reason }));
    }
  }

  const groups = new Map<string, Target[]>();
  for (const target of due) {
    if (target.platform === "tiktok" && !support.supported) continue;
    const key = accountKey(target.platform, target.accountId);
    groups.set(key, [...(groups.get(key) ?? []), target]);
  }
  const ordered = [...groups.values()].sort(
    (a, b) =>
      (PLATFORM_ORDER.get(a[0].platform) ?? 0) - (PLATFORM_ORDER.get(b[0].platform) ?? 0) || a[0].accountId.localeCompare(b[0].accountId)
  );

  for (const group of ordered) {
    const result = await syncAccount(group, snapshot, deps, now);
    report.accounts.push(result.account);
    report.fetched += result.account.fetched;
    if (result.degraded) report.status = "partial";
  }

  const finishedAt = deps.now();
  report.finishedAt = finishedAt.toISOString();
  await updateMetrics((store) => {
    store.sync.running = null;
    store.sync.lastAttemptAt = now.toISOString();
    store.sync.lastCompletedAt = finishedAt.toISOString();
    store.sync.lastResult = report.status === "partial" ? "partial" : "ok";
    store.sync.lastError = null;
  });
}

type RecordExtra = { note?: string | null; backoffUntil?: string; source?: AccountSync["source"]; fetched?: number };

function recorder(platform: AnalyticsPlatform, accountId: string, label: string | null, now: Date) {
  const key = accountKey(platform, accountId);
  return async (status: AccountSyncStatus, extra: RecordExtra = {}): Promise<AccountOutcome> => {
    await updateMetrics((store) => {
      const entry: AccountSync = {
        key,
        platform,
        accountId,
        label,
        status,
        note: extra.note ?? null,
        at: now.toISOString(),
        posts: Object.values(store.posts).filter((post) => post.platform === platform && post.accountId === accountId).length
      };
      if (extra.backoffUntil) entry.backoffUntil = extra.backoffUntil;
      if (extra.source) entry.source = extra.source;
      store.accounts[key] = entry;
    });
    return { key, platform, accountId, status, fetched: extra.fetched ?? 0, note: extra.note ?? null };
  };
}

type AccountResult = { account: AccountOutcome; degraded: boolean };

async function syncAccount(group: Target[], snapshot: AnalyticsStore, deps: SyncDeps, now: Date): Promise<AccountResult> {
  const { platform, accountId } = group[0];
  const key = accountKey(platform, accountId);
  const label = await deps.credentials.label(platform, accountId).catch(() => null);
  const record = recorder(platform, accountId, label, now);

  const held = snapshot.accounts[key];
  if (held?.backoffUntil && Date.parse(held.backoffUntil) > now.getTime()) {
    return { account: { key, platform, accountId, status: "rate-limited", fetched: 0, note: held.note }, degraded: true };
  }

  const fingerprint = await deps.credentials.fingerprint(platform, accountId).catch(() => null);
  if (await accountAuthBlocked(platform, accountId, fingerprint, now)) {
    const reason = (await readAuthStates())[key]?.reason ?? "Waiting for the account to be reconnected.";
    return { account: await record("paused-auth", { note: reason }), degraded: true };
  }

  const stopWith = async (stop: Stop, fetched: number, notes: string[]): Promise<AccountResult> => {
    if (stop.kind === "auth") {
      const reason = authFailureReason(stop.error);
      await recordAuthFailure({ platform, accountId, accountLabel: label }, reason, { now, fingerprint }).catch(() => undefined);
      return { account: await record("paused-auth", { note: reason, fetched }), degraded: true };
    }
    if (stop.kind === "rate") {
      const backoffUntil = new Date(now.getTime() + (stop.retryAfterMs ?? DEFAULT_RATE_WAIT_MS)).toISOString();
      const note = stop.error ? "The platform asked for fewer requests." : stop.message;
      return { account: await record("rate-limited", { note, backoffUntil, fetched }), degraded: true };
    }
    if (stop.kind === "quota") {
      const backoffUntil = deps.quota.nextResetAt(now).toISOString();
      return { account: await record("rate-limited", { note: stop.message, backoffUntil, fetched }), degraded: true };
    }
    if (stop.kind === "budget") {
      const note = [...notes, `Read ${fetched} post(s) this run. ${stop.message} The rest follow in the next cycle.`].join(" ");
      return { account: await record("ok", { note, fetched }), degraded: false };
    }
    if (stop.kind === "scope") {
      return { account: await record("unsupported", { note: notes[0] ?? stop.message, fetched }), degraded: true };
    }
    return { account: await record("error", { note: stop.message, fetched }), degraded: true };
  };

  let outcome: FetchOutcome | null;
  try {
    outcome = await fetchFor(platform, accountId, group, snapshot, deps, now);
  } catch (error) {
    const stop = stopFromError(error);
    if (stop) return stopWith(stop, 0, []);
    return { account: await record("error", { note: failureMessage(error) }), degraded: true };
  }

  if (!outcome) {
    return { account: await record("not-connected", { note: "Not connected, so its posts are not measured." }), degraded: false };
  }

  await applyOutcome(platform, outcome, now);
  const fetched = outcome.results.size;
  if (fetched > 0 && outcome.stopped?.kind !== "auth") await clearOlderTrip(platform, accountId, now);
  if (outcome.stopped) return stopWith(outcome.stopped, fetched, outcome.notes);

  const notes = [...outcome.notes];
  if (outcome.failed.length > 0) notes.push(`${outcome.failed.length} post(s) could not be read: ${outcome.failed[0].message}`);
  const status: AccountSyncStatus = outcome.failed.length > 0 && fetched === 0 ? "error" : "ok";
  const source = [...outcome.results.values()][0]?.source;
  return {
    account: await record(status, { note: notes.join(" ") || null, source, fetched }),
    degraded: status === "error"
  };
}

async function clearOlderTrip(platform: AnalyticsPlatform, accountId: string, startedAt: Date): Promise<void> {
  const tripped = (await readAuthStates())[accountKey(platform, accountId)];
  if (!tripped || Date.parse(tripped.lastFailureAt) > startedAt.getTime()) return;
  await clearAuthState(platform, accountId).catch(() => false);
}

function metaCallsPerRun(): number {
  const configured = Number(process.env.ANALYTICS_META_CALLS_PER_RUN);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_META_CALLS_PER_RUN;
}

function oldestFirst(group: Target[], snapshot: AnalyticsStore): Target[] {
  const attemptedAt = (target: Target) => snapshot.posts[postKey(target.platform, target.postId)]?.attemptedAt ?? "";
  return [...group]
    .sort((a, b) => attemptedAt(a).localeCompare(attemptedAt(b)) || b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, MAX_POSTS_PER_ACCOUNT_RUN);
}

async function fetchFor(
  platform: AnalyticsPlatform,
  accountId: string,
  group: Target[],
  snapshot: AnalyticsStore,
  deps: SyncDeps,
  now: Date
): Promise<FetchOutcome | null> {
  switch (platform) {
    case "youtube": {
      const session = await deps.credentials.youtube(accountId);
      if (!session) return null;
      const videos = group.map((target) => ({ id: target.postId, publishedAt: target.publishedAt }));
      return fetchYoutubeMetrics({ token: session.token, videos, now, debit: (units) => deps.quota.debit(units, "analytics") }, deps.http);
    }
    case "instagram": {
      const session = await deps.credentials.instagram(accountId);
      if (!session) return null;
      const ids = oldestFirst(group, snapshot).map((target) => target.postId);
      return fetchInstagramMetrics(session, ids, deps.http, createPacer({ maxCalls: metaCallsPerRun() }));
    }
    case "facebook": {
      const session = await deps.credentials.facebook(accountId);
      if (!session) return null;
      const posts = oldestFirst(group, snapshot).map((target) => ({ id: target.postId, node: facebookNodeOf(target) }));
      return fetchFacebookMetrics(session, posts, deps.http, createPacer({ maxCalls: metaCallsPerRun() }));
    }
    case "threads": {
      const session = await deps.credentials.threads(accountId);
      if (!session) return null;
      return fetchThreadsMetrics(session, oldestFirst(group, snapshot).map((target) => target.postId), deps.http);
    }
    case "tiktok": {
      const session = await deps.credentials.tiktok(accountId);
      if (!session) return null;
      const ids = group.filter((target) => isTiktokVideoId(target.postId)).map((target) => target.postId);
      return ids.length > 0 ? fetchTiktokMetrics(session, ids, deps.http) : newOutcome();
    }
  }
}

async function applyOutcome(platform: AnalyticsPlatform, outcome: FetchOutcome, now: Date): Promise<void> {
  if (outcome.results.size + outcome.gone.length + outcome.failed.length === 0) return;
  await updateMetrics((store) => {
    for (const [postId, fetched] of outcome.results) {
      const key = postKey(platform, postId);
      if (store.posts[key]) store.posts[key] = recordSnapshot(store.posts[key], fetched, now);
    }
    for (const postId of outcome.gone) {
      const post = store.posts[postKey(platform, postId)];
      if (!post) continue;
      post.misses += 1;
      post.attemptedAt = now.toISOString();
      if (post.misses >= GONE_AFTER_MISSES) {
        post.status = "gone";
        post.note = "The platform no longer returns this post.";
      }
    }
    for (const failure of outcome.failed) {
      const post = store.posts[postKey(platform, failure.postId)];
      if (!post) continue;
      post.status = "error";
      post.note = failure.message;
      post.attemptedAt = now.toISOString();
    }
  });
}
