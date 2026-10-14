import { describe, expect, it } from "vitest";
import { createPacer } from "@/lib/analytics/pacing";
import { facebookNodeOf, fetchFacebookMetrics, parseFacebookBasic, parseFacebookInsights } from "@/lib/analytics/facebook";
import { httpDeps } from "@/lib/analytics/test-helpers";

const GRAPH = "https://graph.facebook.com/v23.0";
const creds = { token: "fb-token", graphBase: GRAPH };

function insights(values: Record<string, number>) {
  return { data: Object.entries(values).map(([name, value]) => ({ name, period: "lifetime", values: [{ value }] })) };
}

const metricParam = (call: { url: string }) => new URL(call.url).searchParams.get("metric") ?? "";
const fieldsParam = (call: { url: string }) => new URL(call.url).searchParams.get("fields") ?? "";

describe("facebookNodeOf", () => {
  it("tells a video, a single photo and a feed post apart", () => {
    expect(facebookNodeOf({ postId: "1234", format: "video" })).toBe("video");
    expect(facebookNodeOf({ postId: "1234", format: "long-form" })).toBe("video");
    expect(facebookNodeOf({ postId: "1234", format: "image" })).toBe("photo");
    expect(facebookNodeOf({ postId: "100_555", format: "image" })).toBe("post");
    expect(facebookNodeOf({ postId: "100_555", format: "carousel" })).toBe("post");
    expect(facebookNodeOf({ postId: "777", format: "carousel" })).toBe("post");
  });
});

describe("parseFacebookInsights", () => {
  it("reads Reels plays and turns watch time in milliseconds into seconds and minutes", () => {
    expect(
      parseFacebookInsights(insights({ blue_reels_play_count: 1500, post_video_avg_time_watched: 12500, post_video_view_time: 600000 }))
    ).toEqual({ views: 1500, avgViewSeconds: 12.5, watchMinutes: 10 });
  });

  it("reads total Reels plays and the older video metrics", () => {
    expect(parseFacebookInsights(insights({ fb_reels_total_plays: 90 }))).toEqual({ views: 90 });
    expect(
      parseFacebookInsights(insights({ total_video_views: 400, total_video_avg_time_watched: 8000, total_video_view_total_time: 120000 }))
    ).toEqual({ views: 400, avgViewSeconds: 8, watchMinutes: 2 });
  });

  it("reads post media views and returns nothing for an empty answer", () => {
    expect(parseFacebookInsights(insights({ post_media_view: 320 }))).toEqual({ views: 320 });
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
  it("reads a Reel's plays and watch time from its video_insights edge, and its reaction counts", async () => {
    const { deps, calls } = httpDeps([
      {
        match: "/v1/video_insights",
        reply: { body: insights({ blue_reels_play_count: 900, post_video_avg_time_watched: 8000, post_video_view_time: 120000 }) }
      },
      { match: /\/v1\?fields=/, reply: { body: { likes: { summary: { total_count: 30 } }, comments: { summary: { total_count: 4 } } } } }
    ]);

    const outcome = await fetchFacebookMetrics(creds, [{ id: "v1", node: "video" }], deps);

    expect(outcome.results.get("v1")).toEqual({
      source: "facebook-insights",
      metrics: { views: 900, avgViewSeconds: 8, watchMinutes: 2, likes: 30, comments: 4 }
    });
    expect(metricParam(calls[0])).toBe("blue_reels_play_count,post_video_avg_time_watched,post_video_view_time");
    expect(new URL(calls[0].url).searchParams.get("access_token")).toBe("fb-token");
    expect(fieldsParam(calls[1])).not.toContain("shares");
  });

  it("reads a feed post through the post endpoints and asks for its shares", async () => {
    const { deps, calls } = httpDeps([
      { match: "/100_555/insights", reply: { body: insights({ post_media_view: 410 }) } },
      {
        match: /\/100_555\?fields=/,
        reply: { body: { reactions: { summary: { total_count: 20 } }, comments: { summary: { total_count: 1 } }, shares: { count: 5 } } }
      }
    ]);

    const outcome = await fetchFacebookMetrics(creds, [{ id: "100_555", node: "post" }], deps);

    expect(outcome.results.get("100_555")?.metrics).toEqual({ views: 410, likes: 20, comments: 1, shares: 5 });
    expect(calls.some((call) => call.url.includes("video_insights"))).toBe(false);
    expect(fieldsParam(calls[1])).toContain("shares");
  });

  it("reads a single photo with reactions and comments only: a photo has no shares field and no insights edge", async () => {
    const { deps, calls } = httpDeps([
      { match: /\/ph1\?fields=/, reply: { body: { reactions: { summary: { total_count: 7 } }, comments: { summary: { total_count: 2 } } } } }
    ]);

    const outcome = await fetchFacebookMetrics(creds, [{ id: "ph1", node: "photo" }], deps);

    expect(outcome.results.get("ph1")).toEqual({ source: "facebook-basic", metrics: { likes: 7, comments: 2 } });
    expect(calls).toHaveLength(1);
    expect(fieldsParam(calls[0])).not.toContain("shares");
    expect(fieldsParam(calls[0])).toContain("reactions");
  });

  it("falls back to a shorter field list when Facebook rejects one, and remembers it for the rest of the run", async () => {
    const { deps, calls } = httpDeps([
      {
        match: /\/p\d_1\?fields=/,
        reply: (call) =>
          fieldsParam(call).includes("shares")
            ? { status: 400, body: { error: { code: 100, message: "(#100) Tried accessing nonexisting field (shares)" } } }
            : { body: { reactions: { summary: { total_count: 3 } }, comments: { summary: { total_count: 1 } } } }
      },
      { match: "/insights", reply: { status: 400, body: { error: { code: 100, message: "(#100) The value must be a valid insights metric" } } } }
    ]);

    const outcome = await fetchFacebookMetrics(
      creds,
      [
        { id: "p1_1", node: "post" },
        { id: "p2_1", node: "post" },
        { id: "p3_1", node: "post" }
      ],
      deps
    );

    expect(outcome.results.get("p3_1")?.metrics).toEqual({ likes: 3, comments: 1 });
    expect(calls.filter((call) => fieldsParam(call).includes("shares"))).toHaveLength(1);
  });

  it("falls back to reaction and comment counts when the Page token cannot read insights, and stops asking for them", async () => {
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
        { id: "v1", node: "video" },
        { id: "v2", node: "video" }
      ],
      deps
    );

    expect(outcome.results.get("v2")).toEqual({ source: "facebook-basic", metrics: { likes: 5, comments: 1 } });
    expect(calls.filter((call) => call.url.includes("video_insights"))).toHaveLength(1);
    expect(outcome.notes.join(" ")).toMatch(/read_insights/);
    expect(outcome.stopped).toBeNull();
  });

  it("walks the Reels metric sets when one is not offered, and starts later posts at the set that worked", async () => {
    const { deps, calls } = httpDeps([
      {
        match: "video_insights",
        reply: (call) => {
          const asked = metricParam(call);
          if (asked.includes("blue_reels_play_count")) return { status: 400, body: { error: { code: 100, message: "(#100) invalid metric" } } };
          return { body: insights({ fb_reels_total_plays: 77, post_video_avg_time_watched: 5000 }) };
        }
      },
      { match: /\/v\d\?fields=/, reply: { body: {} } }
    ]);

    const outcome = await fetchFacebookMetrics(
      creds,
      [
        { id: "v1", node: "video" },
        { id: "v2", node: "video" }
      ],
      deps
    );

    expect(outcome.results.get("v1")?.metrics.views).toBe(77);
    expect(outcome.results.get("v2")?.metrics.views).toBe(77);
    const insightCalls = calls.filter((call) => call.url.includes("video_insights")).map(metricParam);
    expect(insightCalls).toEqual([
      "blue_reels_play_count,post_video_avg_time_watched,post_video_view_time",
      "fb_reels_total_plays,post_video_avg_time_watched,post_video_view_time",
      "fb_reels_total_plays,post_video_avg_time_watched,post_video_view_time"
    ]);
  });

  it("does not let one post's 400 count toward giving up on the account", async () => {
    const { deps } = httpDeps([
      { match: "video_insights", reply: { status: 400, body: { error: { code: 200, message: "(#200) Requires read_insights permission" } } } },
      { match: /\/v\d\?fields=/, reply: { status: 400, body: { error: { code: 100, message: "(#100) Invalid parameter" } } } }
    ]);
    const posts = Array.from({ length: 8 }, (_, index) => ({ id: `v${index}`, node: "video" as const }));

    const outcome = await fetchFacebookMetrics(creds, posts, deps);

    expect(outcome.stopped).toBeNull();
    expect(outcome.failed).toHaveLength(8);
  });

  it("stops on an expired Page token", async () => {
    const { deps } = httpDeps([
      { match: "video_insights", reply: { status: 400, body: { error: { code: 190, message: "Error validating access token" } } } }
    ]);

    const outcome = await fetchFacebookMetrics(creds, [{ id: "v1", node: "video" }], deps);

    expect(outcome.stopped?.kind).toBe("auth");
  });

  it("stops when it has used its calls for the run, keeping what it read", async () => {
    const { deps, calls } = httpDeps([
      { match: "video_insights", reply: { body: insights({ blue_reels_play_count: 1 }) } },
      { match: /\/v\d\?fields=/, reply: { body: { likes: { summary: { total_count: 1 } } } } }
    ]);
    const posts = Array.from({ length: 4 }, (_, index) => ({ id: `v${index}`, node: "video" as const }));

    const outcome = await fetchFacebookMetrics(creds, posts, deps, createPacer({ maxCalls: 5 }));

    expect(calls).toHaveLength(5);
    expect(outcome.stopped).toMatchObject({ kind: "budget" });
    expect(outcome.results.size).toBe(2);
  });
});
