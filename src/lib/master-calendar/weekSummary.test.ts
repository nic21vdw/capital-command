import { describe, expect, it } from "vitest";
import { buildWeekSummary } from "@/lib/master-calendar/weekSummary";
import type { MasterCalendarEvent } from "@/lib/master-calendar/types";
import type { YoutubeStat } from "@/lib/publisher/youtubeStatsShared";

const event = (over: Partial<MasterCalendarEvent>): MasterCalendarEvent => ({
  id: "shorts:q1",
  source: "shorts",
  dateKey: "2026-10-09",
  time: "08:00",
  title: "A short",
  platforms: ["YouTube"],
  status: "published",
  href: "/uploading-center?item=q1&platform=youtube",
  ...over
});

const stat = (views: number | null, likes: number | null = 0): YoutubeStat => ({
  views,
  likes,
  comments: 0,
  fetchedAt: "2026-10-10T20:00:00.000Z"
});

const row = (summary: ReturnType<typeof buildWeekSummary>, id: string) => summary.rows.find((r) => r.id === id)!;

describe("the seven-day window", () => {
  it("covers the end day and the six before it, and nothing else", () => {
    const summary = buildWeekSummary({
      endKey: "2026-10-11",
      events: [
        event({ id: "a", dateKey: "2026-10-04", legs: [{ platform: "YouTube", status: "published" }] }),
        event({ id: "b", dateKey: "2026-10-05", legs: [{ platform: "YouTube", status: "published" }] }),
        event({ id: "c", dateKey: "2026-10-11", legs: [{ platform: "YouTube", status: "published" }] }),
        event({ id: "d", dateKey: "2026-10-12", legs: [{ platform: "YouTube", status: "published" }] })
      ]
    });
    expect(summary.startKey).toBe("2026-10-05");
    expect(row(summary, "youtube").published).toBe(2);
  });
});

describe("per-platform outcomes", () => {
  it("counts each leg of a queued post on its own platform", () => {
    const summary = buildWeekSummary({
      endKey: "2026-10-11",
      events: [
        event({
          platforms: ["YouTube", "Instagram", "TikTok", "Facebook"],
          status: "partly failed",
          legs: [
            { platform: "YouTube", status: "published" },
            { platform: "Instagram", status: "published" },
            { platform: "TikTok", status: "failed" },
            { platform: "Facebook", status: "manual" }
          ]
        }),
        event({
          id: "shorts:q2",
          platforms: ["YouTube", "Instagram"],
          status: "scheduled",
          legs: [
            { platform: "YouTube", status: "scheduled" },
            { platform: "Instagram", status: "pending" }
          ]
        })
      ]
    });
    expect(row(summary, "youtube")).toMatchObject({ published: 1, scheduled: 1, failed: 0 });
    expect(row(summary, "instagram")).toMatchObject({ published: 1, scheduled: 1 });
    expect(row(summary, "tiktok")).toMatchObject({ failed: 1, published: 0 });
    expect(row(summary, "facebook")).toMatchObject({ byHand: 1 });
    expect(summary.totals).toEqual({ published: 2, failed: 1, byHand: 1, scheduled: 2 });
  });

  it("reads Threads and Facebook library posts from the event's own status", () => {
    const summary = buildWeekSummary({
      endKey: "2026-10-11",
      events: [
        event({ id: "x:1", source: "x", platforms: ["Threads"], status: "published" }),
        event({ id: "x:2", source: "x", platforms: ["Threads"], status: "partly failed", failedPlatforms: ["Threads"] }),
        event({ id: "x:3", source: "x", platforms: ["X", "Threads"], status: "planned" }),
        event({ id: "fb:1", source: "fb", platforms: ["Facebook"], status: "posted" }),
        event({ id: "fb:2", source: "fb", platforms: ["Instagram"], status: "draft" })
      ]
    });
    expect(row(summary, "threads")).toMatchObject({ published: 1, failed: 1, byHand: 0, scheduled: 0 });
    expect(row(summary, "facebook").published).toBe(1);
    expect(row(summary, "instagram").byHand).toBe(1);
  });

  it("ignores repeating-carousel reminders: they have no done state", () => {
    const summary = buildWeekSummary({
      endKey: "2026-10-11",
      events: [event({ id: "carousel:s:1", source: "carousels", platforms: ["TikTok"], status: "reminder", recurring: true })]
    });
    expect(summary.totals).toEqual({ published: 0, failed: 0, byHand: 0, scheduled: 0 });
  });

  it("keeps the most recent published post for a one-click way to its numbers", () => {
    const summary = buildWeekSummary({
      endKey: "2026-10-11",
      events: [
        event({ id: "a", dateKey: "2026-10-08", title: "Older", legs: [{ platform: "Facebook", status: "published", url: "https://www.facebook.com/1" }] }),
        event({ id: "b", dateKey: "2026-10-10", title: "Newer", href: "/uploading-center?item=b", legs: [{ platform: "Facebook", status: "published" }] })
      ]
    });
    expect(row(summary, "facebook").latest).toEqual({ title: "Newer", dateKey: "2026-10-10", href: "/uploading-center?item=b" });
  });

  it("says where each platform's numbers live", () => {
    const summary = buildWeekSummary({ endKey: "2026-10-11", events: [] });
    expect(row(summary, "instagram").numbersNote).toBe("Views on Instagram - open the post");
    expect(row(summary, "youtube").numbersNote).toMatch(/read from YouTube/);
  });
});

describe("YouTube totals and the top post", () => {
  const videos = [
    event({ id: "a", title: "Small", dateKey: "2026-10-08", youtube: { itemId: "ia", videoId: "vid-aaaaaa" }, legs: [{ platform: "YouTube", status: "published" }] }),
    event({ id: "b", title: "Big", dateKey: "2026-10-09", youtube: { itemId: "ib", videoId: "vid-bbbbbb" }, legs: [{ platform: "YouTube", status: "published" }] }),
    event({ id: "c", title: "No numbers", dateKey: "2026-10-10", youtube: { itemId: "ic", videoId: "vid-cccccc" }, legs: [{ platform: "YouTube", status: "published" }] })
  ];

  it("adds up views and likes, names the top video and counts the ones with no numbers", () => {
    const summary = buildWeekSummary({
      endKey: "2026-10-11",
      events: videos,
      stats: { "vid-aaaaaa": stat(100, 5), "vid-bbbbbb": stat(2610, 96) }
    });
    expect(summary.youtube).toMatchObject({ videos: 2, views: 2710, likes: 101, missing: 1, fetchedAt: "2026-10-10T20:00:00.000Z" });
    expect(summary.top).toMatchObject({ title: "Big", views: 2610, likes: 96, videoId: "vid-bbbbbb", dateKey: "2026-10-09" });
    expect(summary.top?.studioUrl).toContain("/video/vid-bbbbbb/analytics");
    expect(summary.top?.watchUrl).toBe("https://www.youtube.com/watch?v=vid-bbbbbb");
    expect(summary.youtubeTargets.map((t) => t.itemId)).toEqual(["ia", "ib", "ic"]);
  });

  it("has no top post, and no invented zero, when nothing is cached", () => {
    const summary = buildWeekSummary({ endKey: "2026-10-11", events: videos });
    expect(summary.top).toBeNull();
    expect(summary.youtube).toMatchObject({ videos: 0, views: 0, missing: 3, fetchedAt: null });
  });

  it("does not rank a video whose views YouTube hides", () => {
    const summary = buildWeekSummary({ endKey: "2026-10-11", events: videos, stats: { "vid-aaaaaa": stat(null) } });
    expect(summary.top).toBeNull();
  });
});
