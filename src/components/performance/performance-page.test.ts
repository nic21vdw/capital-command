import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PerformanceBody } from "@/components/performance/performance-page";
import { platformTotals, rowsFromStore } from "@/lib/analytics/query";
import type { AnalyticsReport } from "@/lib/analytics/report";
import { emptyStore, type PostRecord } from "@/lib/analytics/types";
import { derivePerformance, type PerformanceView } from "@/lib/analytics/view";

(globalThis as { React?: typeof React }).React = React;

const DAY = 86_400_000;
const NOW = new Date("2026-10-13T12:00:00.000Z");

function record(platform: PostRecord["platform"], postId: string, daysAgo: number, views: number | null, overrides: Partial<PostRecord> = {}): PostRecord {
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
    latest: views === null ? null : { at: NOW.toISOString(), metrics: { views, likes: Math.round(views / 20), comments: 2 } },
    history: views === null ? [] : [10, 20, 40].map((value, index) => ({ date: `2026-10-1${index}`, at: NOW.toISOString(), views: value })),
    misses: 0,
    ...overrides
  };
}

function report(): AnalyticsReport {
  const store = emptyStore();
  for (const entry of [
    record("youtube", "yt-a", 1, 1200),
    record("youtube", "yt-b", 12, 5400),
    record("instagram", "ig-a", 2, 800, { source: "instagram-basic" }),
    record("threads", "th-a", 3, 90, { format: "text", title: "", caption: "Most of the work is deciding what not to build." }),
    record("tiktok", "7001", 4, null, { status: "unsupported", note: "TikTok needs video.list." }),
    record("facebook", "fb-car", 5, 300, { format: "carousel", visibility: "private" })
  ]) {
    store.posts[entry.key] = entry;
  }
  const rows = rowsFromStore(store);
  return {
    generatedAt: NOW.toISOString(),
    sync: { lastAttemptAt: NOW.toISOString(), lastCompletedAt: NOW.toISOString(), lastResult: "ok", lastError: null, running: false, nextDueAt: null },
    accounts: [
      {
        key: "threads:primary",
        platform: "threads",
        accountId: "primary",
        label: "nic",
        status: "paused-auth",
        note: "Session has expired",
        at: NOW.toISOString(),
        posts: 1
      }
    ],
    posts: rows,
    totals: { last7: platformTotals(rows, 7, NOW), last28: platformTotals(rows, 28, NOW) }
  };
}

const view: PerformanceView = { platform: "all", range: "28d", sort: "views", direction: "desc" };

function render(overrides: Partial<PerformanceView> = {}, empty = false) {
  const current = { ...view, ...overrides };
  return renderToStaticMarkup(
    createElement(PerformanceBody, {
      derived: derivePerformance(report(), current, NOW),
      view: current,
      shown: 100,
      onSort: vi.fn(),
      onPlatform: vi.fn(),
      onRange: vi.fn(),
      onMore: vi.fn(),
      empty
    })
  );
}

describe("PerformanceBody", () => {
  it("shows the totals for the last 7 and 28 days, the top posts and a row per post", () => {
    const html = render();

    expect(html).toContain("Last 7 days");
    expect(html).toContain("Last 28 days");
    expect(html).toContain("Top 10 by views");
    expect(html).toContain("#1");
    expect(html).toContain("Title yt-b");
    expect(html).toContain("5.4K");
    expect(html).toContain("Posts <span");
    expect(html).toContain("(6)");
    expect(html).toContain('href="https://www.youtube.com/watch?v=yt-a"');
  });

  it("uses the caption for a post with no title, and marks what could not be measured", () => {
    const html = render();

    expect(html).toContain("Most of the work is deciding what not to build.");
    expect(html).toContain("Not measurable");
    expect(html).toContain("Carousel");
    expect(html).toContain("private");
    expect(html).toContain("Likes and comments only");
  });

  it("marks the sorted column and draws a trend for a post with history", () => {
    const html = render();

    expect(html).toMatch(/aria-sort="descending"/);
    expect(html).toContain("<polyline");
  });

  it("narrows to one platform", () => {
    const html = render({ platform: "instagram" });

    expect(html).toContain("Title ig-a");
    expect(html).not.toContain("Title yt-a");
    expect(html).toContain('aria-pressed="true"');
  });

  it("explains an empty store", () => {
    expect(render({}, true)).toContain("Nothing has been measured yet");
  });
});

describe("derivePerformance", () => {
  it("applies the platform and range filters to the rows but computes totals per platform from the whole report", () => {
    const derived = derivePerformance(report(), { ...view, platform: "youtube", range: "7d" }, NOW);

    expect(derived.rows.map((row) => row.postId)).toEqual(["yt-a"]);
    expect(derived.totals.last28.map((entry) => entry.platform)).toEqual(["youtube"]);
    expect(derived.notices.map((notice) => notice.text)).toEqual(["Threads · nic needs reconnecting: Session has expired"]);
  });
});
