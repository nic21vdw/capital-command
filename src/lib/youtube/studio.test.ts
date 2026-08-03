import { describe, expect, it } from "vitest";
import {
  MONETIZATION_SUBSCRIBERS,
  MONETIZATION_WATCH_HOURS,
  deriveStudioOverview,
  parseYouTubeVideoId,
  visibilityForStatus
} from "./studio";
import type { ContentItem, CreatorProfile } from "@/types/domain";

const NOW = new Date("2026-06-03T00:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

let seq = 0;
function mkItem(input: Partial<ContentItem>): ContentItem {
  seq += 1;
  return {
    id: input.id ?? `c-${seq}`,
    title: input.title ?? "Untitled",
    type: input.type ?? "Video",
    platform: input.platform ?? "YouTube",
    status: input.status ?? "Published",
    publishDate: input.publishDate,
    url: input.url ?? "",
    views: input.views,
    likes: input.likes,
    comments: input.comments,
    watchHours: input.watchHours,
    revenue: input.revenue,
    notes: input.notes ?? "",
    createdAt: input.createdAt ?? NOW.toISOString(),
    updatedAt: input.updatedAt ?? NOW.toISOString()
  };
}

function mkProfile(input: Partial<CreatorProfile>): CreatorProfile {
  return {
    channelName: input.channelName ?? "Test Channel",
    platform: input.platform ?? "YouTube",
    subscribers: input.subscribers ?? 0,
    totalViews: input.totalViews ?? 0,
    watchHours: input.watchHours ?? 0,
    monetized: input.monetized ?? false,
    subscriberGoal: input.subscriberGoal ?? 1000,
    monthlyRevenueGoal: input.monthlyRevenueGoal ?? 0,
    updatedAt: NOW.toISOString()
  };
}

describe("parseYouTubeVideoId", () => {
  it("handles the common URL shapes", () => {
    expect(parseYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeVideoId("https://www.youtube.com/shorts/abc123XYZ_-")).toBe("abc123XYZ_-");
    expect(parseYouTubeVideoId("https://youtube.com/live/streamId99")).toBe("streamId99");
  });

  it("returns null for anything without a video id", () => {
    expect(parseYouTubeVideoId("https://youtube.com")).toBeNull();
    expect(parseYouTubeVideoId("")).toBeNull();
    expect(parseYouTubeVideoId(undefined)).toBeNull();
    expect(parseYouTubeVideoId("not a url")).toBeNull();
  });
});

describe("visibilityForStatus", () => {
  it("maps the pipeline status onto Studio visibility", () => {
    expect(visibilityForStatus("Published")).toBe("Public");
    expect(visibilityForStatus("Scheduled")).toBe("Scheduled");
    expect(visibilityForStatus("Idea")).toBe("Draft");
    expect(visibilityForStatus("Editing")).toBe("Draft");
  });
});

describe("deriveStudioOverview", () => {
  it("lists only YouTube items, newest first", () => {
    const overview = deriveStudioOverview(
      [
        mkItem({ id: "old", publishDate: daysAgo(40), views: 100 }),
        mkItem({ id: "new", publishDate: daysAgo(2), views: 100 }),
        mkItem({ id: "tiktok", platform: "TikTok", publishDate: daysAgo(1), views: 999 })
      ],
      mkProfile({}),
      { now: NOW }
    );

    expect(overview.rows.map((row) => row.id)).toEqual(["new", "old"]);
    expect(overview.publishedCount).toBe(2);
  });

  it("judges top and under performers against the channel median", () => {
    const overview = deriveStudioOverview(
      [
        mkItem({ id: "smash", publishDate: daysAgo(10), views: 10000, likes: 500, comments: 100 }),
        mkItem({ id: "mid-a", publishDate: daysAgo(9), views: 1000 }),
        mkItem({ id: "mid-b", publishDate: daysAgo(8), views: 1000 }),
        mkItem({ id: "flop", publishDate: daysAgo(7), views: 100 })
      ],
      mkProfile({}),
      { now: NOW }
    );

    expect(overview.insights.medianViews).toBe(1000);
    expect(overview.insights.topPerformers.map((row) => row.id)).toEqual(["smash"]);
    expect(overview.insights.underPerformers.map((row) => row.id)).toEqual(["flop"]);

    const smash = overview.rows.find((row) => row.id === "smash");
    expect(smash?.performance).toBe("top");
    expect(smash?.engagementRate ?? 0).toBeGreaterThan(0);
  });

  it("gives no performance verdict on too few published videos", () => {
    const overview = deriveStudioOverview(
      [mkItem({ id: "only", publishDate: daysAgo(3), views: 500 })],
      mkProfile({}),
      { now: NOW }
    );

    expect(overview.insights.topPerformers).toHaveLength(0);
    expect(overview.insights.underPerformers).toHaveLength(0);
  });

  it("names the bottleneck and projects watch hours from cadence", () => {
    const overview = deriveStudioOverview(
      [
        mkItem({ id: "a", publishDate: daysAgo(60), watchHours: 200, views: 100 }),
        mkItem({ id: "b", publishDate: daysAgo(30), watchHours: 200, views: 100 }),
        mkItem({ id: "c", publishDate: daysAgo(10), watchHours: 200, views: 100 })
      ],
      mkProfile({ subscribers: 200, watchHours: 3000 }),
      { now: NOW }
    );

    const m = overview.monetization;
    expect(m.eligible).toBe(false);
    expect(m.subscriberTarget).toBe(MONETIZATION_SUBSCRIBERS);
    expect(m.watchHourTarget).toBe(MONETIZATION_WATCH_HOURS);
    expect(m.subscribersRemaining).toBe(800);
    expect(m.watchHoursRemaining).toBe(1000);
    // subscriberPct (20%) < watchHourPct (75%), so subscribers are further behind.
    expect(m.bottleneck).toBe("subscribers");
    expect(m.uploadsPerMonth ?? 0).toBeGreaterThan(0);
    expect(m.avgWatchHoursPerUpload).toBe(200);
    expect(m.projectedWatchHourDate).toBeTruthy();
  });

  it("has no bottleneck or projection once eligible", () => {
    const overview = deriveStudioOverview([], mkProfile({ subscribers: 1500, watchHours: 5000, monetized: true }), {
      now: NOW
    });

    expect(overview.monetization.eligible).toBe(true);
    expect(overview.monetization.bottleneck).toBe("none");
    expect(overview.monetization.projectedWatchHourDate).toBeNull();
  });
});
