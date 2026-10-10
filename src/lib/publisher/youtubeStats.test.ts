import { describe, expect, it, vi } from "vitest";
import {
  chunk,
  idsDueForRefresh,
  mergeStats,
  parseStatistics,
  resolveYoutubeStats,
  StatsNotPermittedError,
  type RawStats,
  type StatsCache,
  type StatsDeps
} from "@/lib/publisher/youtubeStats";
import { agoLabel, compactCount, statsLine, studioAnalyticsUrl, totalViews } from "@/lib/publisher/youtubeStatsShared";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

function deps(overrides: Partial<StatsDeps> & { cache?: StatsCache; fetched?: Record<string, RawStats> } = {}) {
  const written: StatsCache[] = [];
  const fetchStatistics = vi.fn(async (_account: string, ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, overrides.fetched?.[id] ?? { views: 10, likes: 1, comments: 0 }]))
  );
  const built: StatsDeps = {
    now: () => NOW,
    readCache: async () => overrides.cache ?? {},
    writeCache: async (cache) => {
      written.push(cache);
    },
    isConnected: async () => true,
    fetchStatistics,
    failures: new Map(),
    ...overrides
  };
  return { built, written, fetchStatistics: built.fetchStatistics as typeof fetchStatistics };
}

describe("parsing and merging", () => {
  it("reads string counts and leaves hidden ones null", () => {
    expect(parseStatistics({ statistics: { viewCount: "1284", likeCount: "47", commentCount: "3" } })).toEqual({
      views: 1284,
      likes: 47,
      comments: 3
    });
    expect(parseStatistics({ statistics: { viewCount: "9" } })).toEqual({ views: 9, likes: null, comments: null });
    expect(parseStatistics(undefined)).toEqual({ views: null, likes: null, comments: null });
  });

  it("splits into batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("is due when missing or at least 30 minutes old", () => {
    const cache: StatsCache = {
      fresh: { views: 1, likes: 1, comments: 1, fetchedAt: minutesAgo(29) },
      old: { views: 1, likes: 1, comments: 1, fetchedAt: minutesAgo(30) },
      broken: { views: 1, likes: 1, comments: 1, fetchedAt: "nonsense" }
    };
    expect(idsDueForRefresh(["fresh", "old", "gone", "broken"], cache, NOW)).toEqual(["old", "gone", "broken"]);
  });

  it("merge replaces what was read, keeps the rest, and trims to the newest", () => {
    const cache: StatsCache = {
      a: { views: 1, likes: 0, comments: 0, fetchedAt: minutesAgo(90) },
      b: { views: 2, likes: 0, comments: 0, fetchedAt: minutesAgo(80) }
    };
    const merged = mergeStats(cache, { a: { views: 5, likes: 1, comments: 0 } }, NOW);
    expect(merged.a).toEqual({ views: 5, likes: 1, comments: 0, fetchedAt: NOW.toISOString() });
    expect(merged.b).toBe(cache.b);
    expect(Object.keys(mergeStats(cache, { a: { views: 5, likes: 1, comments: 0 } }, NOW, 1))).toEqual(["a"]);
  });
});

describe("resolveYoutubeStats", () => {
  it("serves fresh cache without calling YouTube", async () => {
    const { built, fetchStatistics } = deps({ cache: { v1: { views: 7, likes: 1, comments: 0, fetchedAt: minutesAgo(5) } } });
    const result = await resolveYoutubeStats([{ videoId: "v1", accountId: "yt" }], built);
    expect(fetchStatistics).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "ok", message: null, stats: { v1: { views: 7 } } });
  });

  it("refreshes stale ids per account, in batches of 50, and writes the cache", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `video${String(i).padStart(4, "0")}`);
    const { built, fetchStatistics, written } = deps();
    const result = await resolveYoutubeStats(
      ids.map((videoId, i) => ({ videoId, accountId: i < 100 ? "a" : "b" })),
      built
    );
    expect(fetchStatistics.mock.calls.map(([account, batch]) => [account, batch.length])).toEqual([
      ["a", 50],
      ["a", 50],
      ["b", 20]
    ]);
    expect(result.status).toBe("ok");
    expect(Object.keys(result.stats)).toHaveLength(120);
    expect(written).toHaveLength(1);
    expect(written[0]["video0000"].fetchedAt).toBe(NOW.toISOString());
  });

  it("without a sign-in never touches the network and returns cached values", async () => {
    const cache: StatsCache = { v1: { views: 7, likes: 1, comments: 0, fetchedAt: minutesAgo(300) } };
    const { built, fetchStatistics, written } = deps({ cache, isConnected: async () => false });
    const result = await resolveYoutubeStats([{ videoId: "v1", accountId: "yt" }, { videoId: "v2", accountId: "yt" }], built);
    expect(fetchStatistics).not.toHaveBeenCalled();
    expect(written).toHaveLength(0);
    expect(result.status).toBe("not-connected");
    expect(result.stats).toEqual({ v1: cache.v1 });
    expect(result.message).toMatch(/Connect YouTube/);
  });

  it("a grant without read access counts as not connected", async () => {
    const { built } = deps({
      fetchStatistics: async () => {
        throw new StatsNotPermittedError("HTTP 403");
      }
    });
    const result = await resolveYoutubeStats([{ videoId: "v1", accountId: "yt" }], built);
    expect(result.status).toBe("not-connected");
    expect(built.failures.size).toBe(0);
  });

  it("a failed read keeps the last numbers (stale), or reports error with none, and backs off", async () => {
    const cache: StatsCache = { v1: { views: 7, likes: 1, comments: 0, fetchedAt: minutesAgo(300) } };
    const boom = vi.fn(async () => {
      throw new Error("HTTP 500");
    });
    const stale = deps({ cache, fetchStatistics: boom });
    const first = await resolveYoutubeStats([{ videoId: "v1", accountId: "yt" }], stale.built);
    expect(first.status).toBe("stale");
    expect(first.stats.v1.views).toBe(7);
    // Second call inside the backoff does not call YouTube again.
    const second = await resolveYoutubeStats([{ videoId: "v1", accountId: "yt" }], stale.built);
    expect(second.status).toBe("stale");
    expect(boom).toHaveBeenCalledTimes(1);

    const empty = deps({ fetchStatistics: boom });
    const none = await resolveYoutubeStats([{ videoId: "v9", accountId: "yt" }], empty.built);
    expect(none).toMatchObject({ status: "error", stats: {} });
    expect(none.message).toBeTruthy();
  });

  it("does not throw when the cache cannot be read or written", async () => {
    const { built } = deps({
      readCache: async () => {
        throw new Error("disk");
      },
      writeCache: async () => {
        throw new Error("disk");
      }
    });
    const result = await resolveYoutubeStats([{ videoId: "v1", accountId: "yt" }], built);
    expect(result.status).toBe("ok");
    expect(result.stats.v1.views).toBe(10);
  });
});

describe("formatting", () => {
  it("compacts counts", () => {
    expect([0, 999, 1000, 1234, 12345, 999600, 1_500_000].map(compactCount)).toEqual([
      "0",
      "999",
      "1K",
      "1.2K",
      "12K",
      "1M",
      "1.5M"
    ]);
  });

  it("words the line, singular, and leaves hidden counts out", () => {
    expect(statsLine({ views: 1234, likes: 45, comments: 3 })).toBe("1.2K views · 45 likes · 3 comments");
    expect(statsLine({ views: 1, likes: 1, comments: 1 })).toBe("1 view · 1 like · 1 comment");
    expect(statsLine({ views: 12, likes: null, comments: null })).toBe("12 views");
  });

  it("says how old", () => {
    expect(agoLabel(minutesAgo(0), NOW)).toBe("just now");
    expect(agoLabel(minutesAgo(12), NOW)).toBe("12 min ago");
    expect(agoLabel(minutesAgo(180), NOW)).toBe("3 h ago");
    expect(agoLabel(minutesAgo(60 * 24 * 5), NOW)).toBe("5 days ago");
  });

  it("totals views over videos that have a number, once each", () => {
    const stats = {
      a: { views: 100, likes: 5, comments: 0, fetchedAt: "x" },
      b: { views: null, likes: null, comments: null, fetchedAt: "x" }
    };
    expect(totalViews(stats, ["a", "a", "b", "c"])).toEqual({ views: 100, likes: 5, videos: 1 });
  });

  it("links to the video's analytics tab", () => {
    expect(studioAnalyticsUrl("abc123XYZ_-")).toBe(
      "https://studio.youtube.com/video/abc123XYZ_-/analytics/tab-overview/period-default"
    );
  });
});
