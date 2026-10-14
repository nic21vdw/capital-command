import { describe, expect, it } from "vitest";
import { fetchFacebookMetrics, parseFacebookBasic, parseFacebookInsights } from "@/lib/analytics/facebook";
import { httpDeps } from "@/lib/analytics/test-helpers";

const GRAPH = "https://graph.facebook.com/v23.0";
const creds = { token: "fb-token", graphBase: GRAPH };

function insights(values: Record<string, number>) {
  return { data: Object.entries(values).map(([name, value]) => ({ name, period: "lifetime", values: [{ value }] })) };
}

describe("parseFacebookInsights", () => {
  it("turns video watch time in milliseconds into seconds and minutes", () => {
    expect(
      parseFacebookInsights(insights({ total_video_views: 1500, total_video_avg_time_watched: 12500, total_video_view_total_time: 600000 }))
    ).toEqual({ views: 1500, avgViewSeconds: 12.5, watchMinutes: 10 });
  });

  it("reads post media views", () => {
    expect(parseFacebookInsights(insights({ post_media_view: 320 }))).toEqual({ views: 320 });
  });

  it("returns nothing for an empty answer", () => {
    expect(parseFacebookInsights({ data: [] })).toEqual({});
    expect(parseFacebookInsights(undefined)).toEqual({});
  });
});

describe("parseFacebookBasic", () => {
  it("reads reaction, comment and share counts from the summaries", () => {
    expect(
      parseFacebookBasic({
        reactions: { summary: { total_count: 12 } },
        comments: { summary: { total_count: 3 } },
        shares: { count: 2 }
      })
    ).toEqual({ likes: 12, comments: 3, shares: 2 });
  });

  it("accepts a video node's likes summary", () => {
    expect(parseFacebookBasic({ likes: { summary: { total_count: 8 } }, comments: { summary: { total_count: 0 } } })).toEqual({
      likes: 8,
      comments: 0
    });
  });
});

describe("fetchFacebookMetrics", () => {
  it("reads a Reel's video insights and its reaction counts", async () => {
    const { deps, calls } = httpDeps([
      {
        match: "/v1/video_insights",
        reply: { body: insights({ total_video_views: 900, total_video_avg_time_watched: 8000, total_video_view_total_time: 120000 }) }
      },
      { match: /\/v1\?fields=/, reply: { body: { likes: { summary: { total_count: 30 } }, comments: { summary: { total_count: 4 } } } } }
    ]);

    const outcome = await fetchFacebookMetrics(creds, [{ id: "v1", image: false }], deps);

    expect(outcome.results.get("v1")).toEqual({
      source: "facebook-insights",
      metrics: { views: 900, avgViewSeconds: 8, watchMinutes: 2, likes: 30, comments: 4 }
    });
    expect(new URL(calls[0].url).searchParams.get("access_token")).toBe("fb-token");
  });

  it("reads a picture post through the post endpoints", async () => {
    const { deps, calls } = httpDeps([
      { match: "/p1_1/insights", reply: { body: insights({ post_media_view: 410 }) } },
      {
        match: /\/p1_1\?fields=/,
        reply: { body: { reactions: { summary: { total_count: 20 } }, comments: { summary: { total_count: 1 } }, shares: { count: 5 } } }
      }
    ]);

    const outcome = await fetchFacebookMetrics(creds, [{ id: "p1_1", image: true }], deps);

    expect(outcome.results.get("p1_1")?.metrics).toEqual({ views: 410, likes: 20, comments: 1, shares: 5 });
    expect(calls.some((call) => call.url.includes("video_insights"))).toBe(false);
  });

  it("falls back to reaction and comment counts when the Page token cannot read insights", async () => {
    const { deps, calls } = httpDeps([
      {
        match: "video_insights",
        reply: { status: 400, body: { error: { code: 200, message: "(#200) Requires read_insights permission" } } }
      },
      { match: /\/v\d\?fields=/, reply: { body: { likes: { summary: { total_count: 5 } }, comments: { summary: { total_count: 1 } } } } }
    ]);

    const outcome = await fetchFacebookMetrics(
      creds,
      [
        { id: "v1", image: false },
        { id: "v2", image: false }
      ],
      deps
    );

    expect(outcome.results.get("v2")).toEqual({ source: "facebook-basic", metrics: { likes: 5, comments: 1 } });
    expect(calls.filter((call) => call.url.includes("video_insights"))).toHaveLength(1);
    expect(outcome.notes.join(" ")).toMatch(/read_insights/);
    expect(outcome.stopped).toBeNull();
  });

  it("tries the next metric set when the first is no longer offered", async () => {
    const { deps, calls } = httpDeps([
      {
        match: "video_insights",
        reply: (call) =>
          new URL(call.url).searchParams.get("metric")!.includes("total_video_views")
            ? { status: 400, body: { error: { code: 100, message: "(#100) The value must be a valid insights metric" } } }
            : { body: insights({ post_video_views: 77 }) }
      },
      { match: /\/v1\?fields=/, reply: { body: {} } }
    ]);

    const outcome = await fetchFacebookMetrics(creds, [{ id: "v1", image: false }], deps);

    expect(outcome.results.get("v1")?.metrics.views).toBe(77);
    expect(calls.filter((call) => call.url.includes("video_insights"))).toHaveLength(2);
  });

  it("stops on an expired Page token", async () => {
    const { deps } = httpDeps([
      { match: "video_insights", reply: { status: 400, body: { error: { code: 190, message: "Error validating access token" } } } }
    ]);

    const outcome = await fetchFacebookMetrics(creds, [{ id: "v1", image: false }], deps);

    expect(outcome.stopped?.kind).toBe("auth");
  });
});
