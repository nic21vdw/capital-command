import { describe, expect, it } from "vitest";
import {
  buildOutlierInsights,
  computeBaseline,
  detectOutliers,
  formatDurationSeconds,
  mergeOutliers,
  outlierStoreSchema,
  parseChannelInput,
  parseIsoDuration,
  type Outlier,
  type VideoStats,
  type WatchlistChannel
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
    durationSeconds: input.durationSeconds ?? null,
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
    likes: null,
    comments: null,
    durationSeconds: null,
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

describe("parseIsoDuration", () => {
  it("parses common video durations", () => {
    expect(parseIsoDuration("PT45S")).toBe(45);
    expect(parseIsoDuration("PT1M30S")).toBe(90);
    expect(parseIsoDuration("PT2H3M4S")).toBe(7384);
    expect(parseIsoDuration("P1DT2H")).toBe(93_600);
  });

  it("returns null for missing, malformed, or zero durations", () => {
    expect(parseIsoDuration(null)).toBeNull();
    expect(parseIsoDuration(undefined)).toBeNull();
    expect(parseIsoDuration("not a duration")).toBeNull();
    // Live streams report P0D while they have no fixed length.
    expect(parseIsoDuration("P0D")).toBeNull();
  });
});

describe("formatDurationSeconds", () => {
  it("formats like YouTube", () => {
    expect(formatDurationSeconds(45)).toBe("0:45");
    expect(formatDurationSeconds(754)).toBe("12:34");
    expect(formatDurationSeconds(3723)).toBe("1:02:03");
  });
});

describe("buildOutlierInsights", () => {
  const channel: WatchlistChannel = {
    id: CHANNEL.id,
    title: CHANNEL.title,
    handle: null,
    thumbnailUrl: null,
    uploadsPlaylistId: null,
    addedAt: "2026-07-01T00:00:00.000Z",
    lastFetchedAt: NOW.toISOString(),
    lastError: null,
    baseline: { medianViews: 1000, sampleSize: 5, computedAt: NOW.toISOString() },
    group: "",
    recentVideos: [
      video({ videoId: "p1", views: 1000, likes: 50, comments: 10, durationSeconds: 600 }),
      video({ videoId: "p2", views: 900, likes: 45, comments: 9, durationSeconds: 660 }),
      video({ videoId: "p3", views: 1100, likes: 55, comments: 11, durationSeconds: 540 }),
      video({ videoId: "hot", views: 10_000, likes: 900, comments: 300, durationSeconds: 60 })
    ]
  };

  const outlier: Outlier = {
    videoId: "hot",
    channelId: CHANNEL.id,
    channelTitle: CHANNEL.title,
    title: "How I Shipped 3 Apps in a Week #ai",
    url: "https://www.youtube.com/watch?v=hot",
    thumbnailUrl: null,
    views: 10_000,
    baselineViews: 1000,
    multiplier: 10,
    likes: 900,
    comments: 300,
    durationSeconds: 60,
    publishedAt: "2026-07-08T12:00:00.000Z",
    detectedAt: NOW.toISOString(),
    lastSeenAt: NOW.toISOString(),
    tag: ""
  };

  it("computes rates, format, and channel comparisons, excluding the video from its own norm", () => {
    const insights = buildOutlierInsights(outlier, channel);
    expect(insights.format).toBe("short");
    expect(insights.durationSeconds).toBe(60);
    expect(insights.channelMedianDurationSeconds).toBe(600); // peers only, not the 60s outlier
    expect(insights.likeRate).toBeCloseTo(0.09);
    expect(insights.channelMedianLikeRate).toBeCloseTo(0.05);
    expect(insights.cpr).toBeCloseTo(30);
    expect(insights.channelMedianCpr).toBeCloseTo(10);
    expect(insights.viewsPerDay).toBe(5000); // 10k views over 2 days
  });

  it("credits the short format, engagement, and title patterns in whatWorked", () => {
    const insights = buildOutlierInsights(outlier, channel);
    const all = insights.whatWorked.join(" ");
    expect(all).toContain("10.0×");
    expect(all).toContain("Short");
    expect(all).toContain("Like rate");
    expect(all).toContain("CPR");
    expect(all).toContain("how-to promise");
    expect(all).toContain("concrete number");
    expect(all).toContain("hashtags");
    expect(insights.watchouts).toEqual(["Nothing negative stands out in the public stats — engagement is in line with the reach."]);
    expect(insights.missingData).toEqual([]);
  });

  it("flags weak engagement as a watchout", () => {
    const clickbaity = { ...outlier, likes: 100, comments: 10 }; // 1% like rate vs 5% norm, 1 CPR vs 10
    const insights = buildOutlierInsights(clickbaity, channel);
    expect(insights.watchouts.some((note) => note.includes("Like rate"))).toBe(true);
    expect(insights.watchouts.some((note) => note.includes("CPR"))).toBe(true);
  });

  it("reports missing data instead of guessing when stats are absent", () => {
    const bare = { ...outlier, likes: null, comments: null, durationSeconds: null };
    const insights = buildOutlierInsights(bare, undefined);
    expect(insights.format).toBeNull();
    expect(insights.likeRate).toBeNull();
    expect(insights.cpr).toBeNull();
    expect(insights.missingData).toHaveLength(3);
    // The headline multiplier line is always available.
    expect(insights.whatWorked[0]).toContain("10.0×");
  });
});

describe("outlierStoreSchema", () => {
  it("parses an empty object into sane defaults", () => {
    const store = outlierStoreSchema.parse({});
    expect(store.channels).toEqual([]);
    expect(store.outliers).toEqual([]);
    expect(store.runs).toEqual([]);
    expect(store.config).toEqual({ multiplier: 3, baselineWindow: 10, cooldownMinutes: 60 });
    expect(store.competitorInsights).toEqual([]);
  });

  it("parses a pre-competition store file, defaulting the new fields", () => {
    // Shape of data/youtube-outliers.json before channel groups / AI insights existed.
    const legacy = {
      channels: [
        {
          id: "UCabcdefghijklmnopqrstuv",
          title: "Old Channel",
          handle: null,
          thumbnailUrl: null,
          uploadsPlaylistId: "UUabcdefghijklmnopqrstuv",
          addedAt: "2026-01-01T00:00:00.000Z",
          lastFetchedAt: null,
          lastError: null,
          baseline: null,
          recentVideos: []
        }
      ],
      outliers: [],
      runs: [],
      config: { multiplier: 3, baselineWindow: 10, cooldownMinutes: 60 }
    };
    const store = outlierStoreSchema.parse(legacy);
    expect(store.channels[0].group).toBe("");
    expect(store.competitorInsights).toEqual([]);
  });
});
