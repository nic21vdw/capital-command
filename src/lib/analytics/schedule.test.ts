import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIRST_TICK_MS,
  SYNC_INTERVAL_MS,
  TICK_MS,
  analyticsSyncDue,
  analyticsSyncEnabled,
  analyticsTick,
  startAnalyticsSync,
  stopAnalyticsSync
} from "@/lib/analytics/schedule";
import type { SyncReport } from "@/lib/analytics/sync";
import { emptyStore, type SyncMeta } from "@/lib/analytics/types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = new Date("2026-10-13T12:00:00.000Z");

const report: SyncReport = {
  status: "ok",
  startedAt: NOW.toISOString(),
  finishedAt: NOW.toISOString(),
  considered: 0,
  fetched: 0,
  accounts: []
};

function meta(overrides: Partial<SyncMeta> = {}): SyncMeta {
  return { ...emptyStore().sync, ...overrides };
}

const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("analyticsSyncDue", () => {
  it("is due when nothing has ever been synced", () => {
    expect(analyticsSyncDue(meta(), NOW)).toBe(true);
  });

  it("waits six hours after the last completed sync", () => {
    expect(SYNC_INTERVAL_MS).toBe(6 * HOUR);
    const done = { lastAttemptAt: ago(5 * HOUR + 59 * MINUTE), lastCompletedAt: ago(5 * HOUR + 59 * MINUTE), lastResult: "ok" as const };
    expect(analyticsSyncDue(meta(done), NOW)).toBe(false);
    expect(analyticsSyncDue(meta({ ...done, lastCompletedAt: ago(6 * HOUR), lastAttemptAt: ago(6 * HOUR) }), NOW)).toBe(true);
  });

  it("counts a partial sync as done, but retries a failed one after half an hour", () => {
    const partial = meta({ lastAttemptAt: ago(HOUR), lastCompletedAt: ago(HOUR), lastResult: "partial" });
    expect(analyticsSyncDue(partial, NOW)).toBe(false);

    const failed = (minutes: number) => meta({ lastAttemptAt: ago(minutes * MINUTE), lastCompletedAt: ago(2 * HOUR), lastResult: "error" });
    expect(analyticsSyncDue(failed(10), NOW)).toBe(false);
    expect(analyticsSyncDue(failed(31), NOW)).toBe(true);
  });

  it("is not due while a sync is marked running", () => {
    expect(analyticsSyncDue(meta({ running: { pid: process.pid, startedAt: ago(MINUTE) } }), NOW)).toBe(false);
  });
});

describe("analyticsSyncEnabled", () => {
  it("is on unless switched off", () => {
    expect(analyticsSyncEnabled({})).toBe(true);
    expect(analyticsSyncEnabled({ ANALYTICS_SYNC: "on" })).toBe(true);
    for (const off of ["off", "0", "false", "no", "OFF"]) expect(analyticsSyncEnabled({ ANALYTICS_SYNC: off })).toBe(false);
  });
});

describe("analyticsTick", () => {
  it("syncs when due and does nothing when not", async () => {
    const sync = vi.fn(async () => report);

    expect(await analyticsTick({ sync, readMeta: async () => meta(), now: () => NOW })).toBe(report);
    expect(sync).toHaveBeenCalledTimes(1);

    const recent = meta({ lastAttemptAt: ago(HOUR), lastCompletedAt: ago(HOUR), lastResult: "ok" });
    expect(await analyticsTick({ sync, readMeta: async () => recent, now: () => NOW })).toBeNull();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("never throws, whatever the sync does", async () => {
    const sync = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(analyticsTick({ sync, readMeta: async () => meta(), now: () => NOW })).resolves.toBeNull();
  });
});

describe("startAnalyticsSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    stopAnalyticsSync();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("makes a first check two minutes after start, then checks every quarter hour", async () => {
    const sync = vi.fn(async () => report);
    startAnalyticsSync({ sync, readMeta: async () => meta() });

    await vi.advanceTimersByTimeAsync(FIRST_TICK_MS - 1);
    expect(sync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(TICK_MS).toBe(15 * MINUTE);
  });

  it("starts only one timer however many times it is asked", async () => {
    const sync = vi.fn(async () => report);
    startAnalyticsSync({ sync, readMeta: async () => meta() });
    startAnalyticsSync({ sync, readMeta: async () => meta() });
    startAnalyticsSync({ sync, readMeta: async () => meta() });

    await vi.advanceTimersByTimeAsync(FIRST_TICK_MS);

    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("does not start a second sync while one is still running", async () => {
    let finish!: () => void;
    const sync = vi.fn(
      () =>
        new Promise<SyncReport>((resolve) => {
          finish = () => resolve(report);
        })
    );
    startAnalyticsSync({ sync, readMeta: async () => meta() });

    await vi.advanceTimersByTimeAsync(FIRST_TICK_MS + 3 * TICK_MS);
    expect(sync).toHaveBeenCalledTimes(1);

    finish();
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("starts nothing when switched off", async () => {
    vi.stubEnv("ANALYTICS_SYNC", "off");
    const sync = vi.fn(async () => report);

    startAnalyticsSync({ sync, readMeta: async () => meta() });
    await vi.advanceTimersByTimeAsync(HOUR);

    expect(sync).not.toHaveBeenCalled();
  });
});
