import { describe, expect, it } from "vitest";
import { parseSince, platformTotals, queryRows, rowsFromStore, sortRows, topRows } from "@/lib/analytics/query";
import { emptyStore, type AnalyticsStore, type MetricValues, type PostRecord } from "@/lib/analytics/types";

const DAY = 86_400_000;
const NOW = new Date("2026-10-13T12:00:00.000Z");

function record(platform: PostRecord["platform"], postId: string, daysAgo: number, metrics: MetricValues | null, overrides: Partial<PostRecord> = {}): PostRecord {
  return {
    key: `${platform}:${postId}`,
    platform,
    accountId: `${platform}-primary`,
    postId,
    itemId: `item-${postId}`,
    format: "video",
    title: `Title ${postId}`,
    caption: `Caption ${postId}`,
    publishedAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
    status: "ok",
    latest: metrics ? { at: NOW.toISOString(), metrics } : null,
    history: [],
    misses: 0,
    ...overrides
  };
}

function storeOf(...records: PostRecord[]): AnalyticsStore {
  const store = emptyStore();
  for (const entry of records) store.posts[entry.key] = entry;
  return store;
}

const fixture = () =>
  storeOf(
    record("youtube", "yt-a", 1, { views: 1000, likes: 50, comments: 10 }),
    record("youtube", "yt-b", 10, { views: 5000, likes: 100, comments: 20 }),
    record("youtube", "yt-c", 40, { views: 200, likes: 2, comments: 0 }),
    record("instagram", "ig-a", 2, { views: 800, reach: 600, likes: 80, comments: 8, shares: 4, saves: 8 }),
    record("threads", "th-a", 3, { views: 300, likes: 30, replies: 6, reposts: 3, quotes: 1 }),
    record("facebook", "fb-a", 5, null),
    record("tiktok", "tt-a", 6, null, { status: "unsupported", note: "Needs video.list" })
  );

describe("rowsFromStore", () => {
  it("turns records into rows with the engagement rate, a link and a views trend", () => {
    const store = storeOf(
      record("youtube", "yt-a", 1, { views: 1000, likes: 50, comments: 10 }, {
        history: Array.from({ length: 40 }, (_, index) => ({ date: `2026-09-${String((index % 28) + 1).padStart(2, "0")}`, at: NOW.toISOString(), views: index * 10 }))
      })
    );

    const [row] = rowsFromStore(store);

    expect(row).toMatchObject({
      key: "youtube:yt-a",
      title: "Title yt-a",
      url: "https://www.youtube.com/watch?v=yt-a",
      metrics: { views: 1000, likes: 50, comments: 10 },
      engagements: 60
    });
    expect(row.engagementRate).toBeCloseTo(0.06);
    expect(row.trend).toHaveLength(30);
    expect(row.trend[29]).toBe(390);
  });

  it("gives an unmeasured post empty metrics, no rate and its note", () => {
    const rows = rowsFromStore(fixture());
    const tiktok = rows.find((row) => row.platform === "tiktok")!;

    expect(tiktok).toMatchObject({ metrics: {}, engagementRate: null, status: "unsupported", note: "Needs video.list", url: null });
  });
});

describe("queryRows", () => {
  const rows = () => rowsFromStore(fixture());

  it("filters by platform, one or several", () => {
    expect(queryRows(rows(), { platform: "youtube" }, NOW).map((row) => row.postId).sort()).toEqual(["yt-a", "yt-b", "yt-c"]);
    expect(queryRows(rows(), { platform: ["instagram", "threads"] }, NOW).map((row) => row.postId).sort()).toEqual(["ig-a", "th-a"]);
  });

  it("filters by when it was published", () => {
    expect(queryRows(rows(), { since: "7d" }, NOW).map((row) => row.postId).sort()).toEqual(["fb-a", "ig-a", "th-a", "tt-a", "yt-a"]);
    expect(queryRows(rows(), { since: new Date(NOW.getTime() - 20 * DAY) }, NOW)).toHaveLength(6);
    expect(queryRows(rows(), { since: "2026-10-01", until: "2026-10-05" }, NOW).map((row) => row.postId)).toEqual(["yt-b"]);
  });

  it("sorts newest first by default, and by views or engagement on request, unmeasured last", () => {
    expect(queryRows(rows(), {}, NOW).map((row) => row.postId)).toEqual(["yt-a", "ig-a", "th-a", "fb-a", "tt-a", "yt-b", "yt-c"]);
    expect(queryRows(rows(), { sort: "views" }, NOW).map((row) => row.postId).slice(0, 4)).toEqual(["yt-b", "yt-a", "ig-a", "th-a"]);
    expect(queryRows(rows(), { sort: "views" }, NOW).map((row) => row.postId).slice(-2)).toEqual(expect.arrayContaining(["fb-a", "tt-a"]));
    expect(queryRows(rows(), { sort: "engagement" }, NOW).map((row) => row.postId)[0]).toBe("th-a");
  });

  it("returns the top N by views, leaving out posts that were never measured", () => {
    const top = queryRows(rows(), { top: 3 }, NOW);

    expect(top.map((row) => row.postId)).toEqual(["yt-b", "yt-a", "ig-a"]);
    expect(topRows(rows(), 100, "views").map((row) => row.postId)).not.toContain("tt-a");
  });

  it("combines filters", () => {
    expect(queryRows(rows(), { platform: "youtube", since: "28d", top: 1 }, NOW).map((row) => row.postId)).toEqual(["yt-b"]);
  });
});

describe("platformTotals", () => {
  it("adds up what each platform's posts from the last N days have earned so far", () => {
    const totals = platformTotals(rowsFromStore(fixture()), 7, NOW);

    const youtube = totals.find((entry) => entry.platform === "youtube")!;
    expect(youtube).toMatchObject({ posts: 1, measured: 1, views: 1000, likes: 50, comments: 10, engagements: 60 });
    expect(youtube.engagementRate).toBeCloseTo(0.06);
    const instagram = totals.find((entry) => entry.platform === "instagram")!;
    expect(instagram).toMatchObject({ views: 800, shares: 4, saves: 8, engagements: 100 });
    expect(totals.find((entry) => entry.platform === "threads")).toMatchObject({ views: 300, engagements: 40 });
  });

  it("counts a post that was never measured as a post but adds nothing", () => {
    const facebook = platformTotals(rowsFromStore(fixture()), 7, NOW).find((entry) => entry.platform === "facebook")!;

    expect(facebook).toMatchObject({ posts: 1, measured: 0, views: 0, engagementRate: null });
  });

  it("widens to 28 days and leaves platforms with no posts out", () => {
    const totals = platformTotals(rowsFromStore(fixture()), 28, NOW);

    expect(totals.find((entry) => entry.platform === "youtube")).toMatchObject({ posts: 2, views: 6000 });
    expect(platformTotals([], 28, NOW)).toEqual([]);
  });
});

describe("parseSince", () => {
  it("reads N days, an ISO date and nothing", () => {
    expect(parseSince("7d", NOW)?.toISOString()).toBe(new Date(NOW.getTime() - 7 * DAY).toISOString());
    expect(parseSince("2026-10-01", NOW)?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(parseSince("2026-10-01T08:30:00.000Z", NOW)?.toISOString()).toBe("2026-10-01T08:30:00.000Z");
    expect(parseSince("", NOW)).toBeNull();
    expect(parseSince(null, NOW)).toBeNull();
    expect(parseSince("soon", NOW)).toBeNull();
  });
});

describe("sortRows", () => {
  const rows = () => rowsFromStore(fixture());

  it("sorts by title, ascending or descending", () => {
    expect(sortRows(rows(), "title", "asc").map((row) => row.postId).slice(0, 3)).toEqual(["fb-a", "ig-a", "th-a"]);
    expect(sortRows(rows(), "title", "desc")[0].postId).toBe("yt-c");
  });

  it("sorts by platform, newest first inside each", () => {
    expect(sortRows(rows(), "platform", "asc").map((row) => row.postId)).toEqual(["fb-a", "ig-a", "th-a", "tt-a", "yt-a", "yt-b", "yt-c"]);
  });

  it("keeps posts with no number at the bottom whichever way views are sorted", () => {
    const asc = sortRows(rows(), "views", "asc").map((row) => row.postId);
    const desc = sortRows(rows(), "views", "desc").map((row) => row.postId);

    expect(asc.slice(0, 3)).toEqual(["yt-c", "th-a", "ig-a"]);
    expect(asc.slice(-2)).toEqual(expect.arrayContaining(["fb-a", "tt-a"]));
    expect(desc.slice(-2)).toEqual(expect.arrayContaining(["fb-a", "tt-a"]));
  });
});
