import { describe, expect, it } from "vitest";
import {
  buildCompetitorTrendReport,
  channelGroupOptions,
  describeReportForPrompt,
  normalizeGroupLabel,
  selectCompetitorChannels
} from "@/lib/youtube/competitor-trends";
import type { Outlier, WatchlistChannel } from "@/lib/youtube/outliers";

const NOW = new Date("2026-07-10T12:00:00Z");

function channel(input: Partial<WatchlistChannel> & { id: string; title: string }): WatchlistChannel {
  return {
    id: input.id,
    title: input.title,
    handle: input.handle ?? null,
    thumbnailUrl: null,
    uploadsPlaylistId: null,
    addedAt: "2026-06-01T00:00:00.000Z",
    lastFetchedAt: input.lastFetchedAt === undefined ? NOW.toISOString() : input.lastFetchedAt,
    lastError: null,
    baseline: input.baseline ?? { medianViews: 1000, sampleSize: 10, computedAt: NOW.toISOString() },
    recentVideos: input.recentVideos ?? [],
    group: input.group ?? ""
  };
}

function outlier(input: Partial<Outlier> & { videoId: string; channelId: string; title: string }): Outlier {
  return {
    videoId: input.videoId,
    channelId: input.channelId,
    channelTitle: input.channelTitle ?? input.channelId,
    title: input.title,
    url: `https://www.youtube.com/watch?v=${input.videoId}`,
    thumbnailUrl: null,
    views: input.views ?? 10_000,
    baselineViews: input.baselineViews ?? 1000,
    multiplier: input.multiplier ?? 10,
    likes: input.likes ?? null,
    comments: input.comments ?? null,
    durationSeconds: input.durationSeconds ?? null,
    publishedAt: input.publishedAt ?? "2026-07-01T00:00:00.000Z",
    detectedAt: NOW.toISOString(),
    lastSeenAt: NOW.toISOString(),
    tag: ""
  };
}

const CH_A = "UCaaaaaaaaaaaaaaaaaaaaaa";
const CH_B = "UCbbbbbbbbbbbbbbbbbbbbbb";
const CH_C = "UCcccccccccccccccccccccc";

describe("normalizeGroupLabel / channelGroupOptions / selectCompetitorChannels", () => {
  it("normalizes whitespace and caps length", () => {
    expect(normalizeGroupLabel("  Competition   in  our  space ")).toBe("Competition in our space");
    expect(normalizeGroupLabel("x".repeat(100))).toHaveLength(60);
  });

  it("dedupes group options case-insensitively, first casing wins", () => {
    const channels = [
      channel({ id: CH_A, title: "A", group: "Competition" }),
      channel({ id: CH_B, title: "B", group: "competition" }),
      channel({ id: CH_C, title: "C", group: "Aspirational" })
    ];
    expect(channelGroupOptions(channels)).toEqual(["Aspirational", "Competition"]);
  });

  it("selects by group case-insensitively, and the whole watchlist for null", () => {
    const channels = [
      channel({ id: CH_A, title: "A", group: "Competition" }),
      channel({ id: CH_B, title: "B", group: "competition" }),
      channel({ id: CH_C, title: "C", group: "" })
    ];
    expect(selectCompetitorChannels(channels, "COMPETITION").map((c) => c.id)).toEqual([CH_A, CH_B]);
    // No labeling required: null analyzes every channel, labeled or not.
    expect(selectCompetitorChannels(channels, null).map((c) => c.id)).toEqual([CH_A, CH_B, CH_C]);
  });
});

describe("buildCompetitorTrendReport", () => {
  const channels = [
    channel({ id: CH_A, title: "Alpha AI", group: "Competition" }),
    channel({ id: CH_B, title: "Beta Builds", group: "Competition" }),
    channel({ id: CH_C, title: "Unrelated", group: "" })
  ];
  const outliers = [
    outlier({
      videoId: "a1",
      channelId: CH_A,
      channelTitle: "Alpha AI",
      title: "How I Built a SaaS with Vibe Coding in 7 Days",
      multiplier: 12,
      views: 120_000,
      durationSeconds: 600,
      publishedAt: "2026-06-20T00:00:00.000Z"
    }),
    outlier({
      videoId: "a2",
      channelId: CH_A,
      channelTitle: "Alpha AI",
      title: "Vibe Coding Is Changing Everything?",
      multiplier: 5,
      views: 50_000,
      durationSeconds: 90,
      publishedAt: "2026-07-01T00:00:00.000Z"
    }),
    outlier({
      videoId: "b1",
      channelId: CH_B,
      channelTitle: "Beta Builds",
      title: "Vibe Coding a $10k Business with AI",
      multiplier: 8,
      views: 80_000,
      durationSeconds: 720,
      publishedAt: "2026-06-25T00:00:00.000Z"
    }),
    // Belongs to the unlabeled channel — must never leak into the group report.
    outlier({ videoId: "c1", channelId: CH_C, channelTitle: "Unrelated", title: "Vibe Coding Golf Swings", multiplier: 20 })
  ];

  it("aggregates only the group's channels and outliers", () => {
    const report = buildCompetitorTrendReport(channels, outliers, { group: "Competition", now: NOW });
    expect(report.channelCount).toBe(2);
    expect(report.channelsWithOutliers).toBe(2);
    expect(report.outlierCount).toBe(3);
    expect(report.topOutliers.map((v) => v.videoId)).toEqual(["a1", "b1", "a2"]);
    expect(report.topOutliers.some((v) => v.videoId === "c1")).toBe(false);
    expect(report.medianMultiplier).toBe(8);
    expect(report.formatSplit).toEqual({ shorts: 1, long: 2, unknown: 0 });
  });

  it("analyzes the whole watchlist — no labeling required — when no group is chosen", () => {
    const report = buildCompetitorTrendReport(channels, outliers, { group: null, now: NOW });
    expect(report.group).toBeNull();
    expect(report.channelCount).toBe(3);
    expect(report.outlierCount).toBe(4);
    expect(report.topOutliers[0].videoId).toBe("c1");
  });

  it("surfaces cross-channel themes as bigrams and suppresses their component words", () => {
    const report = buildCompetitorTrendReport(channels, outliers, { group: "Competition", now: NOW });
    const vibeCoding = report.themes.find((theme) => theme.phrase === "vibe coding");
    expect(vibeCoding).toBeDefined();
    expect(vibeCoding?.videoCount).toBe(3);
    expect(vibeCoding?.channelCount).toBe(2);
    // "vibe" and "coding" cover the same videos as the bigram — suppressed.
    expect(report.themes.some((theme) => theme.phrase === "vibe")).toBe(false);
    expect(report.themes.some((theme) => theme.phrase === "coding")).toBe(false);
    // Examples are sorted by multiplier.
    expect(vibeCoding?.examples[0].videoId).toBe("a1");
  });

  it("counts packaging signals across the group's titles", () => {
    const report = buildCompetitorTrendReport(channels, outliers, { group: "Competition", now: NOW });
    const byId = new Map(report.titleSignals.map((signal) => [signal.id, signal]));
    expect(byId.get("number")?.videoCount).toBe(2); // "7 Days", "$10k"
    expect(byId.get("number")?.channelCount).toBe(2);
    // One-off signals (below 2 videos and under a 50% share) are noise, not a pattern.
    expect(byId.has("money")).toBe(false);
    expect(byId.has("how-to")).toBe(false);
  });

  it("generates cross-channel takeaways naming the shared theme", () => {
    const report = buildCompetitorTrendReport(channels, outliers, { group: "Competition", now: NOW });
    const all = report.takeaways.join(" ");
    expect(all).toContain("2 of 2 tracked competitors");
    expect(all).toContain("vibe coding");
    expect(report.warnings).toEqual([]);
  });

  it("warns about unscanned and stale channels instead of silently analyzing them", () => {
    const staleChannels = [
      channel({ id: CH_A, title: "Alpha AI", group: "Competition", lastFetchedAt: null }),
      channel({ id: CH_B, title: "Beta Builds", group: "Competition", lastFetchedAt: "2026-06-01T00:00:00.000Z" })
    ];
    const report = buildCompetitorTrendReport(staleChannels, [], { group: "Competition", now: NOW });
    expect(report.warnings.some((warning) => warning.includes("never been scanned"))).toBe(true);
    expect(report.warnings.some((warning) => warning.includes("over a week old"))).toBe(true);
  });

  it("requires repeats within a single channel when only one channel is selected", () => {
    const solo = [channel({ id: CH_A, title: "Alpha AI", group: "Solo" })];
    const soloOutliers = [
      outlier({ videoId: "s1", channelId: CH_A, title: "Claude Code Speedrun", multiplier: 4 }),
      outlier({ videoId: "s2", channelId: CH_A, title: "Claude Code for Beginners", multiplier: 6 }),
      outlier({ videoId: "s3", channelId: CH_A, title: "One-off Topic Nobody Repeats", multiplier: 5 })
    ];
    const report = buildCompetitorTrendReport(solo, soloOutliers, { group: "Solo", now: NOW });
    expect(report.themes.some((theme) => theme.phrase === "claude code")).toBe(true);
    expect(report.themes.some((theme) => theme.phrase === "nobody")).toBe(false);
  });

  it("produces an empty-but-valid report when nothing is labeled", () => {
    const report = buildCompetitorTrendReport(channels, outliers, { group: "Nonexistent", now: NOW });
    expect(report.channelCount).toBe(0);
    expect(report.outlierCount).toBe(0);
    expect(report.themes).toEqual([]);
    expect(report.takeaways).toEqual([]);
  });
});

describe("describeReportForPrompt", () => {
  it("serializes channels, themes, and top videos for the AI prompt", () => {
    const channels = [
      channel({ id: CH_A, title: "Alpha AI", group: "Competition" }),
      channel({ id: CH_B, title: "Beta Builds", group: "Competition" })
    ];
    const outliers = [
      outlier({ videoId: "a1", channelId: CH_A, channelTitle: "Alpha AI", title: "Vibe Coding a Startup", multiplier: 12, views: 120_000 }),
      outlier({ videoId: "b1", channelId: CH_B, channelTitle: "Beta Builds", title: "Vibe Coding My First App", multiplier: 8, views: 80_000 })
    ];
    const report = buildCompetitorTrendReport(channels, outliers, { group: "Competition", now: NOW });
    const prompt = describeReportForPrompt(report);
    expect(prompt).toContain("Group: Competition — 2 channels, 2 breakout videos");
    expect(prompt).toContain("Alpha AI");
    expect(prompt).toContain('"vibe coding": 2 videos across 2 channels');
    expect(prompt).toContain('"Vibe Coding a Startup" — Alpha AI, 12.0×');
  });
});
