import { describe, expect, it } from "vitest";
import type { AnalyticsReport } from "@/lib/analytics/api";
import { buildPerformanceSurface, PERFORMANCE_RANGES } from "@/lib/analytics/surface";
import { platformTotals, rowsFromStore } from "@/lib/analytics/query";
import { emptyStore, type PostRecord } from "@/lib/analytics/types";

const DAY = 86_400_000;
const NOW = new Date("2026-10-13T12:00:00.000Z");

function record(platform: PostRecord["platform"], postId: string, daysAgo: number, views: number, likes: number): PostRecord {
  return {
    key: `${platform}:${postId}`,
    platform,
    accountId: `${platform}-primary`,
    postId,
    itemId: postId,
    format: "video",
    title: `Title ${postId}`,
    caption: "",
    publishedAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
    status: "ok",
    latest: { at: NOW.toISOString(), metrics: { views, likes } },
    history: [],
    misses: 0
  };
}

function report(): AnalyticsReport {
  const store = emptyStore();
  for (const entry of [record("youtube", "yt-a", 1, 1000, 50), record("youtube", "yt-b", 10, 5000, 100), record("instagram", "ig-a", 2, 800, 80)]) {
    store.posts[entry.key] = entry;
  }
  const rows = rowsFromStore(store);
  return {
    generatedAt: NOW.toISOString(),
    sync: { lastAttemptAt: NOW.toISOString(), lastCompletedAt: NOW.toISOString(), lastResult: "ok", lastError: null, running: false, nextDueAt: null },
    accounts: [],
    posts: rows,
    totals: { last7: platformTotals(rows, 7, NOW), last28: platformTotals(rows, 28, NOW) }
  };
}

const view = { platform: "all", range: "28d", sort: "published", direction: "desc" } as const;

describe("buildPerformanceSurface", () => {
  it("offers the filters as fields an agent can set", () => {
    const surface = buildPerformanceSurface({ state: "ready", report: report(), now: NOW, view, shown: 2 });

    expect(surface.fields).toEqual([
      expect.objectContaining({ id: "platform", label: "Platform", value: "all", kind: "select", options: ["all", "youtube", "instagram", "facebook", "threads", "tiktok"] }),
      expect.objectContaining({ id: "range", label: "Published", value: "28d", kind: "select", options: [...PERFORMANCE_RANGES] }),
      expect.objectContaining({ id: "sort", label: "Sort by", value: "published", kind: "select" })
    ]);
  });

  it("offers Sync now, and disables it while a sync runs", () => {
    const idle = buildPerformanceSurface({ state: "ready", report: report(), now: NOW, view, shown: 3 });
    const busy = buildPerformanceSurface({
      state: "ready",
      report: { ...report(), sync: { ...report().sync, running: true } },
      now: NOW,
      view,
      shown: 3
    });

    expect(idle.controls).toEqual([expect.objectContaining({ id: "sync-now", label: "Sync now", disabled: false })]);
    expect(busy.controls[0]).toMatchObject({ id: "sync-now", disabled: true });
  });

  it("reads out the totals, the top posts and the sync state so an agent can answer from numbers", () => {
    const surface = buildPerformanceSurface({ state: "ready", report: report(), now: NOW, view, shown: 3 });
    const reading = (label: string) => surface.readings.find((entry) => entry.label === label)?.value;

    expect(reading("Sync")).toBe("Synced just now");
    expect(reading("YouTube, last 7 days")).toBe("1 post, 1K views, 5% engagement");
    expect(reading("YouTube, last 28 days")).toBe("2 posts, 6K views, 2.5% engagement");
    expect(reading("Instagram, last 7 days")).toBe("1 post, 800 views, 10% engagement");
    expect(reading("Top posts")).toBe("1. Title yt-b (YouTube) 5K views; 2. Title yt-a (YouTube) 1K views; 3. Title ig-a (Instagram) 800 views");
    expect(reading("Posts shown")).toBe("3");
    expect(reading("Needs attention")).toBe("Nothing");
  });

  it("says what is broken in Needs attention", () => {
    const withAccounts: AnalyticsReport = {
      ...report(),
      accounts: [
        {
          key: "threads:primary",
          platform: "threads",
          accountId: "primary",
          label: "nic",
          status: "paused-auth",
          note: "Session has expired",
          at: NOW.toISOString(),
          posts: 4
        }
      ]
    };

    const surface = buildPerformanceSurface({ state: "ready", report: withAccounts, now: NOW, view, shown: 3 });

    expect(surface.readings.find((entry) => entry.label === "Needs attention")?.value).toBe(
      "Threads · nic needs reconnecting: Session has expired"
    );
  });

  it("reports loading and failure as the sync state rather than inventing numbers", () => {
    expect(buildPerformanceSurface({ state: "loading", report: null, now: NOW, view, shown: 0 }).readings).toEqual([
      { label: "Sync", value: "Loading" }
    ]);
    expect(buildPerformanceSurface({ state: "error", report: null, now: NOW, view, shown: 0 }).readings).toEqual([
      { label: "Sync", value: "Could not read the numbers" }
    ]);
  });
});
