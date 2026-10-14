import { readMetrics } from "@/lib/analytics/store";
import { markerIsLive, syncAnalytics, type SyncReport } from "@/lib/analytics/sync";
import type { SyncMeta } from "@/lib/analytics/types";

export const SYNC_INTERVAL_MS = 6 * 60 * 60_000;
export const TICK_MS = 15 * 60_000;
export const FIRST_TICK_MS = 2 * 60_000;
export const RETRY_AFTER_ERROR_MS = 30 * 60_000;

const OFF_VALUES = new Set(["off", "0", "false", "no"]);

export function analyticsSyncEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !OFF_VALUES.has((env.ANALYTICS_SYNC ?? "").trim().toLowerCase());
}

export function analyticsSyncDue(meta: SyncMeta, now: Date): boolean {
  if (markerIsLive(meta.running, now)) return false;
  const attempted = meta.lastAttemptAt ? Date.parse(meta.lastAttemptAt) : NaN;
  if (!Number.isFinite(attempted)) return true;
  const completed = meta.lastCompletedAt ? Date.parse(meta.lastCompletedAt) : NaN;
  if (meta.lastResult === "error" || !Number.isFinite(completed)) return now.getTime() - attempted >= RETRY_AFTER_ERROR_MS;
  return now.getTime() - completed >= SYNC_INTERVAL_MS;
}

export type TickDeps = {
  sync?: () => Promise<SyncReport>;
  readMeta?: () => Promise<SyncMeta>;
  now?: () => Date;
};

type Scheduler = { interval?: NodeJS.Timeout; first?: NodeJS.Timeout; ticking: Promise<unknown> | null };
const shared = globalThis as typeof globalThis & { __analyticsScheduler?: Scheduler };

function scheduler(): Scheduler {
  shared.__analyticsScheduler ??= { ticking: null };
  return shared.__analyticsScheduler;
}

export async function analyticsTick(deps: TickDeps = {}): Promise<SyncReport | null> {
  const state = scheduler();
  if (state.ticking) return null;
  const run = (async () => {
    try {
      const meta = await (deps.readMeta ?? (async () => (await readMetrics()).sync))();
      if (!analyticsSyncDue(meta, (deps.now ?? (() => new Date()))())) return null;
      return await (deps.sync ?? (() => syncAnalytics()))();
    } catch (error) {
      console.warn("[analytics] scheduled sync failed:", error instanceof Error ? error.message : error);
      return null;
    }
  })();
  state.ticking = run;
  try {
    return await run;
  } finally {
    state.ticking = null;
  }
}

export function startAnalyticsSync(deps: TickDeps = {}): void {
  const state = scheduler();
  if (!analyticsSyncEnabled() || state.interval) return;
  const tick = () => void analyticsTick(deps);
  state.interval = setInterval(tick, TICK_MS);
  state.first = setTimeout(tick, FIRST_TICK_MS);
  state.interval.unref?.();
  state.first.unref?.();
}

export function stopAnalyticsSync(): void {
  const state = scheduler();
  if (state.interval) clearInterval(state.interval);
  if (state.first) clearTimeout(state.first);
  shared.__analyticsScheduler = undefined;
}
