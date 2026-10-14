import { describe, expect, it } from "vitest";
import {
  MAX_HISTORY_DAYS,
  dayKey,
  dueForSync,
  engagementRate,
  engagements,
  newPostRecord,
  recordSnapshot
} from "@/lib/analytics/metrics";
import type { PostRecord, Target } from "@/lib/analytics/types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-13T12:00:00.000Z");

function target(overrides: Partial<Target> = {}): Target {
  return {
    platform: "youtube",
    accountId: "youtube-primary",
    postId: "vid12345678",
    itemId: "item-1",
    format: "video",
    title: "A title",
    caption: "A caption",
    publishedAt: new Date(NOW.getTime() - 2 * DAY).toISOString(),
    ...overrides
  };
}

function record(overrides: Partial<PostRecord> = {}): PostRecord {
  return { ...newPostRecord(target()), ...overrides };
}

describe("engagement", () => {
  it("adds the reactions a platform reports and divides by views", () => {
    expect(engagements({ likes: 40, comments: 10, shares: 5, saves: 5 })).toBe(60);
    expect(engagementRate({ views: 1000, likes: 40, comments: 10, shares: 5, saves: 5 })).toBeCloseTo(0.06);
  });

  it("counts Threads replies, reposts and quotes", () => {
    expect(engagements({ likes: 10, replies: 3, reposts: 2, quotes: 1 })).toBe(16);
  });

  it("falls back to reach when a platform reports no views", () => {
    expect(engagementRate({ reach: 200, likes: 20 })).toBeCloseTo(0.1);
  });

  it("is null rather than zero when nothing was read or there are no views", () => {
    expect(engagements({ views: 10 })).toBeNull();
    expect(engagementRate({ likes: 5 })).toBeNull();
    expect(engagementRate({ views: 0, likes: 5 })).toBeNull();
    expect(engagementRate({})).toBeNull();
  });
});

describe("dayKey", () => {
  it("is the UTC calendar day", () => {
    expect(dayKey(new Date("2026-10-13T23:59:59.000Z"))).toBe("2026-10-13");
    expect(dayKey(new Date("2026-10-14T00:00:00.000Z"))).toBe("2026-10-14");
  });
});

describe("recordSnapshot", () => {
  it("keeps the latest values and the day's snapshot, without inventing zeros", () => {
    const next = recordSnapshot(record(), { metrics: { views: 120, likes: 4 }, source: "youtube-data-api" }, NOW);

    expect(next.latest).toEqual({ at: NOW.toISOString(), metrics: { views: 120, likes: 4 } });
    expect(next.history).toEqual([{ date: "2026-10-13", at: NOW.toISOString(), views: 120, likes: 4 }]);
    expect(next.source).toBe("youtube-data-api");
    expect(next.status).toBe("ok");
    expect(next.syncedAt).toBe(NOW.toISOString());
  });

  it("replaces the same day's snapshot instead of adding a second one", () => {
    const first = recordSnapshot(record(), { metrics: { views: 100 }, source: "youtube-data-api" }, NOW);
    const later = new Date(NOW.getTime() + 6 * HOUR - 1000);
    const second = recordSnapshot(first, { metrics: { views: 140 }, source: "youtube-data-api" }, later);

    expect(second.history).toHaveLength(1);
    expect(second.history[0]).toMatchObject({ date: "2026-10-13", views: 140 });
    expect(second.latest?.metrics.views).toBe(140);
  });

  it("adds a snapshot per day and caps the history, dropping the oldest", () => {
    let current = record();
    for (let day = 0; day < MAX_HISTORY_DAYS + 10; day += 1) {
      const at = new Date(NOW.getTime() + day * DAY);
      current = recordSnapshot(current, { metrics: { views: day }, source: "youtube-data-api" }, at);
    }

    expect(current.history).toHaveLength(MAX_HISTORY_DAYS);
    expect(current.history[0].views).toBe(10);
    expect(current.history[MAX_HISTORY_DAYS - 1].views).toBe(MAX_HISTORY_DAYS + 9);
  });

  it("clears a stale error and the miss count", () => {
    const failing = record({ status: "error", note: "HTTP 500", misses: 2 });
    const next = recordSnapshot(failing, { metrics: { views: 1 }, source: "youtube-data-api" }, NOW);

    expect(next).toMatchObject({ status: "ok", misses: 0 });
    expect(next.note).toBeUndefined();
  });

  it("marks a post final once it is read after its 90th day", () => {
    const old = record({ publishedAt: new Date(NOW.getTime() - 91 * DAY).toISOString() });
    const young = record({ publishedAt: new Date(NOW.getTime() - 89 * DAY).toISOString() });

    expect(recordSnapshot(old, { metrics: { views: 5 }, source: "youtube-data-api" }, NOW).final).toBe(true);
    expect(recordSnapshot(young, { metrics: { views: 5 }, source: "youtube-data-api" }, NOW).final).toBeFalsy();
  });
});

describe("dueForSync", () => {
  const fresh = (hoursAgo: number, publishedDaysAgo: number) =>
    record({
      publishedAt: new Date(NOW.getTime() - publishedDaysAgo * DAY).toISOString(),
      syncedAt: new Date(NOW.getTime() - hoursAgo * HOUR).toISOString()
    });

  it("syncs a post nobody has read yet", () => {
    expect(dueForSync(undefined, NOW)).toBe(true);
    expect(dueForSync(record(), NOW)).toBe(true);
  });

  it("reads a post in its first week every cycle, but not twice inside one", () => {
    expect(dueForSync(fresh(2, 3), NOW)).toBe(false);
    expect(dueForSync(fresh(6, 3), NOW)).toBe(true);
  });

  it("reads an older post about once a day", () => {
    expect(dueForSync(fresh(6, 20), NOW)).toBe(false);
    expect(dueForSync(fresh(23, 20), NOW)).toBe(true);
  });

  it("reads a post between one and three months old about every third day", () => {
    expect(dueForSync(fresh(23, 60), NOW)).toBe(false);
    expect(dueForSync(fresh(71, 60), NOW)).toBe(true);
  });

  it("reads a post past 90 days once more for its final snapshot, then never again", () => {
    const pastWindow = new Date(NOW.getTime() - 100 * DAY).toISOString();
    const waiting = record({ publishedAt: pastWindow, syncedAt: new Date(NOW.getTime() - 40 * DAY).toISOString() });

    expect(dueForSync(waiting, NOW)).toBe(true);
    const done = recordSnapshot(waiting, { metrics: { views: 9 }, source: "youtube-data-api" }, NOW);
    expect(dueForSync(done, new Date(NOW.getTime() + 10 * DAY))).toBe(false);
    expect(dueForSync(done, new Date(NOW.getTime() + 10 * DAY), { force: true })).toBe(false);
  });

  it("force reads everything still inside its window, whatever its tier", () => {
    expect(dueForSync(fresh(1, 20), NOW, { force: true })).toBe(true);
  });

  it("never reads a post that cannot be measured", () => {
    expect(dueForSync(record({ status: "unsupported" }), NOW, { force: true })).toBe(false);
  });

  it("looks again at a post the platform stopped returning: once a week, and whenever a sync is forced", () => {
    const gone = (daysAgo: number) =>
      record({ status: "gone", misses: 3, attemptedAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString() });

    expect(dueForSync(gone(2), NOW)).toBe(false);
    expect(dueForSync(gone(7), NOW)).toBe(true);
    expect(dueForSync(gone(1), NOW, { force: true })).toBe(true);
    expect(dueForSync({ ...gone(30), final: true }, NOW, { force: true })).toBe(false);
  });

  it("leaves a post alone for a while after a failed read", () => {
    const failed = record({ status: "error", attemptedAt: new Date(NOW.getTime() - 10 * 60_000).toISOString() });

    expect(dueForSync(failed, NOW)).toBe(false);
    expect(dueForSync(failed, new Date(NOW.getTime() + HOUR))).toBe(true);
  });
});
