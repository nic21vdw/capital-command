import { describe, expect, it } from "vitest";
import {
  computeBaseline,
  detectOutliers,
  mergeOutliers,
  outlierStoreSchema,
  parseChannelInput,
  type Outlier,
  type VideoStats
} from "@/lib/youtube/outliers";

const NOW = new Date("2026-07-10T12:00:00Z");
const CHANNEL = { id: "UCabcdefghijklmnopqrstuv", title: "Test Channel" };

function video(input: Partial<VideoStats> & { videoId: string; views: number }): VideoStats {
  return {
    videoId: input.videoId,
    title: input.title ?? input.videoId,
    publishedAt: input.publishedAt ?? "2026-07-01T00:00:00.000Z",
    views: input.views,
    likes: input.likes ?? null,
    comments: input.comments ?? null,
    thumbnailUrl: input.thumbnailUrl ?? null
  };
}

describe("parseChannelInput", () => {
  it("accepts raw UC channel ids", () => {
    expect(parseChannelInput("UCabcdefghijklmnopqrstuv")).toEqual({ kind: "id", value: "UCabcdefghijklmnopqrstuv" });
  });

  it("accepts handles with and without @, and handle URLs", () => {
    expect(parseChannelInput("@mkbhd")).toEqual({ kind: "handle", value: "mkbhd" });
    expect(parseChannelInput("mkbhd")).toEqual({ kind: "handle", value: "mkbhd" });
    expect(parseChannelInput("https://www.youtube.com/@mkbhd")).toEqual({ kind: "handle", value: "mkbhd" });
    expect(parseChannelInput("youtube.com/@mkbhd/videos")).toEqual({ kind: "handle", value: "mkbhd" });
  });

  it("accepts channel, user, and legacy custom URLs", () => {
    expect(parseChannelInput("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv")).toEqual({
      kind: "id",
      value: "UCabcdefghijklmnopqrstuv"
    });
    expect(parseChannelInput("https://m.youtube.com/user/somebody")).toEqual({ kind: "user", value: "somebody" });
    expect(parseChannelInput("https://youtube.com/c/SomeBrand")).toEqual({ kind: "handle", value: "SomeBrand" });
  });

  it("rejects things that are not channels", () => {
    expect(parseChannelInput("")).toBeNull();
    expect(parseChannelInput("   ")).toBeNull();
    expect(parseChannelInput("https://example.com/@mkbhd")).toBeNull();
    expect(parseChannelInput("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseChannelInput("not a channel!!")).toBeNull();
  });
});

describe("computeBaseline", () => {
  it("takes the median of the newest N videos", () => {
    const videos = [
      video({ videoId: "a", views: 100, publishedAt: "2026-07-01T00:00:00Z" }),
      video({ videoId: "b", views: 300, publishedAt: "2026-07-02T00:00:00Z" }),
      video({ videoId: "c", views: 200, publishedAt: "2026-07-03T00:00:00Z" }),
      // Oldest video falls outside a window of 3.
      video({ videoId: "old", views: 1_000_000, publishedAt: "2026-06-01T00:00:00Z" })
    ];
    expect(computeBaseline(videos, 3)).toEqual({ medianViews: 200, sampleSize: 3 });
  });

  it("averages the middle pair for even sample sizes and handles empty input", () => {
    const videos = [
      video({ videoId: "a", views: 100 }),
      video({ videoId: "b", views: 200 }),
      video({ videoId: "c", views: 400 }),
      video({ videoId: "d", views: 1000 })
    ];
    expect(computeBaseline(videos, 10).medianViews).toBe(300);
    expect(computeBaseline([], 10)).toEqual({ medianViews: 0, sampleSize: 0 });
  });
});

describe("detectOutliers", () => {
  const videos = [
    video({ videoId: "normal", views: 1100 }),
    video({ videoId: "hot", views: 3000, publishedAt: "2026-07-05T00:00:00Z" }),
    video({ videoId: "meh", views: 900 }),
    video({ videoId: "ok", views: 1000 })
  ];

  it("flags videos at or above multiplier × median", () => {
    const baseline = computeBaseline(videos, 10); // median (1000+1100)/2 = 1050
    const flagged = detectOutliers(CHANNEL, videos, baseline, 2, NOW);
    expect(flagged.map((o) => o.videoId)).toEqual(["hot"]);
    expect(flagged[0]).toMatchObject({
      channelId: CHANNEL.id,
      url: "https://www.youtube.com/watch?v=hot",
      views: 3000,
      baselineViews: 1050,
      multiplier: 2.86,
      detectedAt: NOW.toISOString(),
      tag: ""
    });
  });

  it("respects the multiplier threshold boundary (>=)", () => {
    const baseline = { medianViews: 1000, sampleSize: 5 };
    const exactly = [video({ videoId: "exact", views: 3000 })];
    expect(detectOutliers(CHANNEL, exactly, baseline, 3, NOW)).toHaveLength(1);
    const under = [video({ videoId: "under", views: 2999 })];
    expect(detectOutliers(CHANNEL, under, baseline, 3, NOW)).toHaveLength(0);
  });

  it("flags nothing on tiny or zero baselines", () => {
    expect(detectOutliers(CHANNEL, videos, { medianViews: 1050, sampleSize: 2 }, 2, NOW)).toHaveLength(0);
    expect(detectOutliers(CHANNEL, videos, { medianViews: 0, sampleSize: 10 }, 2, NOW)).toHaveLength(0);
  });
});

describe("mergeOutliers", () => {
  const existing: Outlier = {
    videoId: "hot",
    channelId: CHANNEL.id,
    channelTitle: CHANNEL.title,
    title: "Old title",
    url: "https://www.youtube.com/watch?v=hot",
    thumbnailUrl: null,
    views: 3000,
    baselineViews: 1000,
    multiplier: 3,
    publishedAt: "2026-07-05T00:00:00.000Z",
    detectedAt: "2026-07-01T00:00:00.000Z",
    lastSeenAt: "2026-07-01T00:00:00.000Z",
    tag: "strong hook"
  };

  it("preserves tag and first-detected date on re-detection, updating stats", () => {
    const fresh = { ...existing, title: "New title", views: 9000, multiplier: 9, detectedAt: NOW.toISOString(), lastSeenAt: NOW.toISOString(), tag: "" };
    const merged = mergeOutliers([existing], [fresh]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      views: 9000,
      multiplier: 9,
      title: "New title",
      detectedAt: "2026-07-01T00:00:00.000Z",
      lastSeenAt: NOW.toISOString(),
      tag: "strong hook"
    });
  });

  it("keeps previously flagged videos that were not re-detected and adds new ones", () => {
    const brandNew = { ...existing, videoId: "new", tag: "" };
    const merged = mergeOutliers([existing], [brandNew]);
    expect(merged.map((o) => o.videoId).sort()).toEqual(["hot", "new"]);
  });
});

describe("outlierStoreSchema", () => {
  it("parses an empty object into sane defaults", () => {
    const store = outlierStoreSchema.parse({});
    expect(store.channels).toEqual([]);
    expect(store.outliers).toEqual([]);
    expect(store.runs).toEqual([]);
    expect(store.config).toEqual({ multiplier: 3, baselineWindow: 10, cooldownMinutes: 60 });
  });
});
