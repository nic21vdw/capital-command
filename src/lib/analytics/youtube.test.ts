import { describe, expect, it } from "vitest";
import { YOUTUBE_BATCH_SIZE, fetchYoutubeMetrics, parseAnalyticsReport, parseVideoStatistics } from "@/lib/analytics/youtube";
import { httpDeps } from "@/lib/analytics/test-helpers";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const DATA_API = "googleapis.com/youtube/v3/videos";
const ANALYTICS_API = "youtubeanalytics.googleapis.com/v2/reports";

function videos(count: number, publishedAt = "2026-10-01T15:00:00.000Z") {
  return Array.from({ length: count }, (_, index) => ({ id: `vid${String(index).padStart(8, "0")}`, publishedAt }));
}

function dataApiBody(ids: string[]) {
  return {
    items: ids.map((id, index) => ({
      id,
      statistics: { viewCount: String(1000 + index), likeCount: String(10 + index), commentCount: String(index), favoriteCount: "0" }
    }))
  };
}

function analyticsBody(ids: string[]) {
  return {
    columnHeaders: [
      { name: "video" },
      { name: "views" },
      { name: "estimatedMinutesWatched" },
      { name: "averageViewDuration" }
    ],
    rows: ids.map((id, index) => [id, 900 + index, 300.5 + index, 42 + index])
  };
}

const idsOf = (url: string, param: string) => decodeURIComponent(new URL(url).searchParams.get(param) ?? "");

describe("parseVideoStatistics", () => {
  it("reads the string counts YouTube sends and leaves out the ones the owner hides", () => {
    const parsed = parseVideoStatistics({
      items: [
        { id: "a", statistics: { viewCount: "1234", likeCount: "56", commentCount: "7" } },
        { id: "b", statistics: { viewCount: "9", commentCount: "0" } }
      ]
    });

    expect(parsed.get("a")).toEqual({ views: 1234, likes: 56, comments: 7 });
    expect(parsed.get("b")).toEqual({ views: 9, comments: 0 });
  });

  it("ignores an item with no id and a body with no items", () => {
    expect(parseVideoStatistics({ items: [{ statistics: { viewCount: "5" } }] }).size).toBe(0);
    expect(parseVideoStatistics({}).size).toBe(0);
    expect(parseVideoStatistics(null).size).toBe(0);
  });
});

describe("parseAnalyticsReport", () => {
  it("maps columns by name, whatever order they come in", () => {
    const parsed = parseAnalyticsReport({
      columnHeaders: [{ name: "averageViewDuration" }, { name: "video" }, { name: "estimatedMinutesWatched" }, { name: "views" }],
      rows: [[61.5, "abc", 200, 700]]
    });

    expect(parsed.get("abc")).toEqual({ views: 700, watchMinutes: 200, avgViewSeconds: 61.5 });
  });

  it("returns nothing for a report with no rows", () => {
    expect(parseAnalyticsReport({ columnHeaders: [{ name: "video" }] }).size).toBe(0);
  });
});

describe("fetchYoutubeMetrics", () => {
  it("combines the Data API counts with Analytics watch time, and says Analytics was the source", async () => {
    const list = videos(2);
    const ids = list.map((video) => video.id);
    const { deps, calls } = httpDeps([
      { match: ANALYTICS_API, reply: { body: analyticsBody(ids) } },
      { match: DATA_API, reply: { body: dataApiBody(ids) } }
    ]);

    const outcome = await fetchYoutubeMetrics({ token: "tok", videos: list, now: NOW }, deps);

    expect(outcome.analytics).toBe("used");
    expect(outcome.results.get(ids[0])).toEqual({
      source: "youtube-analytics",
      metrics: { views: 1000, likes: 10, comments: 0, watchMinutes: 300.5, avgViewSeconds: 42 }
    });
    const analyticsCall = calls.find((call) => call.url.includes(ANALYTICS_API))!;
    expect(analyticsCall.headers.Authorization).toBe("Bearer tok");
    expect(idsOf(analyticsCall.url, "ids")).toBe("channel==MINE");
    expect(idsOf(analyticsCall.url, "filters")).toBe(`video==${ids.join(",")}`);
    expect(idsOf(analyticsCall.url, "dimensions")).toBe("video");
    expect(idsOf(analyticsCall.url, "startDate")).toBe("2026-10-01");
    expect(idsOf(analyticsCall.url, "endDate")).toBe("2026-10-13");
  });

  it("batches 50 ids per call on both APIs", async () => {
    const list = videos(120);
    const { deps, calls } = httpDeps([
      {
        match: ANALYTICS_API,
        reply: (call) => ({ body: analyticsBody(idsOf(call.url, "filters").replace("video==", "").split(",")) })
      },
      { match: DATA_API, reply: (call) => ({ body: dataApiBody(idsOf(call.url, "id").split(",")) }) }
    ]);

    const outcome = await fetchYoutubeMetrics({ token: "tok", videos: list, now: NOW }, deps);

    const dataCalls = calls.filter((call) => call.url.includes(DATA_API));
    const reportCalls = calls.filter((call) => call.url.includes(ANALYTICS_API));
    expect(YOUTUBE_BATCH_SIZE).toBe(50);
    expect(dataCalls.map((call) => idsOf(call.url, "id").split(",").length)).toEqual([50, 50, 20]);
    expect(reportCalls).toHaveLength(3);
    expect(outcome.results.size).toBe(120);
  });

  it("falls back to Data API statistics when the token has no Analytics scope, and asks Analytics only once", async () => {
    const list = videos(120);
    const { deps, calls } = httpDeps([
      {
        match: ANALYTICS_API,
        reply: {
          status: 403,
          body: { error: { code: 403, message: "Insufficient Permission", errors: [{ reason: "insufficientPermissions" }] } }
        }
      },
      { match: DATA_API, reply: (call) => ({ body: dataApiBody(idsOf(call.url, "id").split(",")) }) }
    ]);

    const outcome = await fetchYoutubeMetrics({ token: "tok", videos: list, now: NOW }, deps);

    expect(outcome.analytics).toBe("unavailable");
    expect(calls.filter((call) => call.url.includes(ANALYTICS_API))).toHaveLength(1);
    expect(outcome.stopped).toBeNull();
    const first = outcome.results.get(list[0].id)!;
    expect(first.source).toBe("youtube-data-api");
    expect(first.metrics).toEqual({ views: 1000, likes: 10, comments: 0 });
    expect(outcome.notes.join(" ")).toMatch(/yt-analytics\.readonly/);
  });

  it("keeps the Data API counts for a video Analytics has no row for", async () => {
    const list = videos(2);
    const ids = list.map((video) => video.id);
    const { deps } = httpDeps([
      { match: ANALYTICS_API, reply: { body: analyticsBody([ids[0]]) } },
      { match: DATA_API, reply: { body: dataApiBody(ids) } }
    ]);

    const outcome = await fetchYoutubeMetrics({ token: "tok", videos: list, now: NOW }, deps);

    expect(outcome.results.get(ids[0])?.source).toBe("youtube-analytics");
    expect(outcome.results.get(ids[1])).toEqual({ source: "youtube-data-api", metrics: { views: 1001, likes: 11, comments: 1 } });
  });

  it("does not ask Analytics at all when told it is known to be unavailable", async () => {
    const list = videos(2);
    const { deps, calls } = httpDeps([{ match: DATA_API, reply: { body: dataApiBody(list.map((video) => video.id)) } }]);

    const outcome = await fetchYoutubeMetrics({ token: "tok", videos: list, now: NOW, analytics: "skip" }, deps);

    expect(outcome.analytics).toBe("skipped");
    expect(calls.every((call) => !call.url.includes(ANALYTICS_API))).toBe(true);
  });

  it("lists a video the Data API did not return as missing", async () => {
    const list = videos(3);
    const { deps } = httpDeps([
      { match: ANALYTICS_API, reply: { body: { columnHeaders: [] } } },
      { match: DATA_API, reply: { body: dataApiBody([list[0].id, list[1].id]) } }
    ]);

    const outcome = await fetchYoutubeMetrics({ token: "tok", videos: list, now: NOW }, deps);

    expect(outcome.gone).toEqual([list[2].id]);
  });

  it("stops on a 429 after the batches it already read, and reports how long to wait", async () => {
    const list = videos(120);
    const { deps } = httpDeps([
      { match: ANALYTICS_API, reply: { status: 403, body: { error: { errors: [{ reason: "insufficientPermissions" }] } } } },
      {
        match: DATA_API,
        reply: (call) => {
          const ids = idsOf(call.url, "id").split(",");
          return ids[0] === list[0].id
            ? { body: dataApiBody(ids) }
            : { status: 429, headers: { "Retry-After": "120" }, body: {} };
        }
      }
    ]);

    const outcome = await fetchYoutubeMetrics({ token: "tok", videos: list, now: NOW }, { ...deps, maxRetries: 1 });

    expect(outcome.results.size).toBe(50);
    expect(outcome.stopped).toMatchObject({ kind: "rate", retryAfterMs: 120_000 });
  });

  it("stops on an expired token, keeping the error for the breaker", async () => {
    const list = videos(3);
    const { deps } = httpDeps([
      { match: ANALYTICS_API, reply: { status: 401, body: { error: { message: "Invalid Credentials" } } } },
      { match: DATA_API, reply: { status: 401, body: { error: { message: "Invalid Credentials" } } } }
    ]);

    const outcome = await fetchYoutubeMetrics({ token: "tok", videos: list, now: NOW }, deps);

    expect(outcome.stopped?.kind).toBe("auth");
    expect(String(outcome.stopped?.error)).toContain("HTTP 401");
    expect(outcome.results.size).toBe(0);
  });

  it("stops on a grant that cannot read statistics at all", async () => {
    const { deps } = httpDeps([
      { match: ANALYTICS_API, reply: { status: 403, body: { error: { errors: [{ reason: "insufficientPermissions" }] } } } },
      { match: DATA_API, reply: { status: 403, body: { error: { errors: [{ reason: "insufficientPermissions" }] } } } }
    ]);

    const outcome = await fetchYoutubeMetrics({ token: "tok", videos: videos(2), now: NOW }, deps);

    expect(outcome.stopped?.kind).toBe("scope");
  });
});
