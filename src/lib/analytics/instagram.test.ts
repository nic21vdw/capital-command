import { describe, expect, it } from "vitest";
import { createPacer } from "@/lib/analytics/pacing";
import { fetchInstagramMetrics, parseInstagramInsights } from "@/lib/analytics/instagram";
import { httpDeps } from "@/lib/analytics/test-helpers";

const GRAPH = "https://graph.facebook.com/v23.0";
const creds = { token: "ig-token", graphBase: GRAPH };

function insights(values: Record<string, number>) {
  return {
    data: Object.entries(values).map(([name, value]) => ({ name, period: "lifetime", values: [{ value }], id: `1/insights/${name}/lifetime` }))
  };
}

const media = (...ids: string[]) => ids.map((id) => ({ id, kind: "FEED" }));
const typed = (kind: string, ...ids: string[]) => ids.map((id) => ({ id, kind }));

const metricsOf = (url: string) => new URL(url).searchParams.get("metric")?.split(",") ?? [];

describe("parseInstagramInsights", () => {
  it("maps Instagram's names to ours and ignores what it does not know", () => {
    expect(
      parseInstagramInsights(insights({ views: 812, reach: 600, likes: 40, comments: 5, shares: 3, saved: 9, total_interactions: 57, weird: 1 }))
    ).toEqual({ views: 812, reach: 600, likes: 40, comments: 5, shares: 3, saves: 9 });
  });

  it("treats the older plays metric as views", () => {
    expect(parseInstagramInsights(insights({ plays: 77, reach: 50 }))).toEqual({ views: 77, reach: 50 });
  });

  it("skips values that are not numbers", () => {
    expect(parseInstagramInsights({ data: [{ name: "reach", values: [{ value: "n/a" }] }] })).toEqual({});
    expect(parseInstagramInsights(null)).toEqual({});
  });
});

describe("fetchInstagramMetrics", () => {
  it("reads views, reach, likes, comments, shares and saves for each media id", async () => {
    const { deps, calls } = httpDeps([
      { match: "/m1/insights", reply: { body: insights({ views: 100, reach: 80, likes: 10, comments: 2, shares: 1, saved: 4 }) } },
      { match: "/m2/insights", reply: { body: insights({ views: 5, reach: 5, likes: 0, comments: 0, shares: 0, saved: 0 }) } }
    ]);

    const outcome = await fetchInstagramMetrics(creds, media("m1", "m2"), deps);

    expect(outcome.results.get("m1")).toEqual({
      source: "instagram-insights",
      metrics: { views: 100, reach: 80, likes: 10, comments: 2, shares: 1, saves: 4 }
    });
    expect(outcome.results.get("m2")?.metrics.likes).toBe(0);
    expect(calls).toHaveLength(2);
    expect(new URL(calls[0].url).searchParams.get("access_token")).toBe("ig-token");
    expect(metricsOf(calls[0].url)).toEqual(["views", "reach", "likes", "comments", "shares", "saved"]);
  });

  it("retries with the older plays metric on a Graph version that still has it", async () => {
    const { deps, calls } = httpDeps([
      {
        match: "/m1/insights",
        reply: (call) =>
          metricsOf(call.url).includes("views")
            ? { status: 400, body: { error: { code: 100, message: "(#100) metric[0] must be one of the following values: plays, reach" } } }
            : { body: insights({ plays: 61, reach: 40, likes: 3, comments: 1, shares: 0, saved: 2 }) }
      }
    ]);

    const outcome = await fetchInstagramMetrics({ token: "ig-token", graphBase: "https://graph.facebook.com/v21.0" }, media("m1"), deps);

    expect(calls).toHaveLength(2);
    expect(metricsOf(calls[1].url)).toContain("plays");
    expect(outcome.results.get("m1")?.metrics).toMatchObject({ views: 61, reach: 40, saves: 2 });
  });

  it("does not ask for plays on v22 and later, where Instagram has dropped it", async () => {
    const { deps, calls } = httpDeps([
      {
        match: "/insights",
        reply: (call) =>
          metricsOf(call.url).includes("views")
            ? { status: 400, body: { error: { code: 100, message: "(#100) views is not supported for this media" } } }
            : { body: insights({ reach: 40, likes: 3, comments: 1, shares: 0, saved: 2 }) }
      }
    ]);

    const outcome = await fetchInstagramMetrics(creds, media("m1"), deps);

    expect(calls.flatMap((call) => metricsOf(call.url))).not.toContain("plays");
    expect(metricsOf(calls[1].url)).toEqual(["reach", "likes", "comments", "shares", "saved"]);
    expect(outcome.results.get("m1")?.metrics).toMatchObject({ reach: 40, saves: 2 });
  });

  it("falls back for one odd media only: the next media of the same type still starts with the full metric set", async () => {
    const refusing = new Set(["odd"]);
    const { deps, calls } = httpDeps([
      {
        match: "/insights",
        reply: (call) =>
          metricsOf(call.url).includes("views") && refusing.has(call.url.split("/").at(-2)!)
            ? { status: 400, body: { error: { code: 100, message: "(#100) views is not supported for this media" } } }
            : { body: insights({ views: 9, reach: 4, likes: 1, comments: 0, shares: 0, saved: 0 }) }
      }
    ]);

    const outcome = await fetchInstagramMetrics(creds, typed("REELS", "odd", "m2", "m3"), deps);

    expect(outcome.results.size).toBe(3);
    expect(calls.filter((call) => metricsOf(call.url).includes("views"))).toHaveLength(3);
    expect(calls).toHaveLength(4);
  });

  it("moves a media type on only after two different media of that type are refused the same way", async () => {
    const { deps, calls } = httpDeps([
      {
        match: "/insights",
        reply: (call) =>
          metricsOf(call.url).includes("views")
            ? { status: 400, body: { error: { code: 100, message: "(#100) views is not supported for this media" } } }
            : { body: insights({ reach: 40, likes: 3, comments: 1, shares: 0, saved: 2 }) }
      }
    ]);

    await fetchInstagramMetrics(creds, typed("CAROUSEL_ALBUM", "c1", "c2", "c3", "c4"), deps);

    expect(calls.filter((call) => metricsOf(call.url).includes("views"))).toHaveLength(2);
    expect(calls).toHaveLength(6);
  });

  it("keeps one media type's refusals from changing another's metric set", async () => {
    const { deps, calls } = httpDeps([
      {
        match: "/insights",
        reply: (call) =>
          metricsOf(call.url).includes("views") && call.url.includes("/carousel")
            ? { status: 400, body: { error: { code: 100, message: "(#100) views is not supported for this media" } } }
            : { body: insights({ views: 5, reach: 4, likes: 1, comments: 0, shares: 0, saved: 0 }) }
      }
    ]);

    const outcome = await fetchInstagramMetrics(
      creds,
      [...typed("CAROUSEL_ALBUM", "carousel1", "carousel2", "carousel3"), ...typed("REELS", "reel1", "reel2")],
      deps
    );

    const reelCalls = calls.filter((call) => call.url.includes("/reel"));
    expect(reelCalls).toHaveLength(2);
    expect(reelCalls.every((call) => metricsOf(call.url).includes("views"))).toBe(true);
    expect(outcome.results.get("reel1")?.metrics.views).toBe(5);
  });

  it("does not let a set that other media were refused on stay demoted once another media gets through it", async () => {
    const refusing = new Set(["a", "c"]);
    const { deps, calls } = httpDeps([
      {
        match: "/insights",
        reply: (call) =>
          metricsOf(call.url).includes("views") && refusing.has(call.url.split("/").at(-2)!)
            ? { status: 400, body: { error: { code: 100, message: "(#100) views is not supported for this media" } } }
            : { body: insights({ views: 5, reach: 4, likes: 1, comments: 0, shares: 0, saved: 0 }) }
      }
    ]);

    await fetchInstagramMetrics(creds, typed("REELS", "a", "b", "c", "d"), deps);

    expect(calls.filter((call) => metricsOf(call.url).includes("views"))).toHaveLength(4);
  });

  it("falls back to likes and comments when the token has no insights permission, and stops asking for insights", async () => {
    const { deps, calls } = httpDeps([
      {
        match: "/insights",
        reply: { status: 400, body: { error: { code: 10, message: "(#10) Application does not have permission for this action" } } }
      },
      { match: /\/m\d\?fields=/, reply: (call) => ({ body: { like_count: Number(call.url.match(/m(\d)\?/)![1]) * 10, comments_count: 2 } }) }
    ]);

    const outcome = await fetchInstagramMetrics(creds, media("m1", "m2", "m3"), deps);

    expect(calls.filter((call) => call.url.includes("/insights"))).toHaveLength(1);
    expect(calls.filter((call) => call.url.includes("fields="))).toHaveLength(3);
    expect(outcome.results.get("m2")).toEqual({ source: "instagram-basic", metrics: { likes: 20, comments: 2 } });
    expect(outcome.notes.join(" ")).toMatch(/instagram_manage_insights/);
    expect(outcome.stopped).toBeNull();
  });

  it("reports a media id Instagram no longer has as gone, without trying every metric set", async () => {
    const { deps, calls } = httpDeps([
      {
        match: "/m1/insights",
        reply: {
          status: 400,
          body: { error: { code: 100, error_subcode: 33, message: "Unsupported get request. Object with ID 'm1' does not exist" } }
        }
      },
      { match: "/m2/insights", reply: { body: insights({ views: 3, reach: 3, likes: 1, comments: 0, shares: 0, saved: 0 }) } }
    ]);

    const outcome = await fetchInstagramMetrics(creds, media("m1", "m2"), deps);

    expect(outcome.gone).toEqual(["m1"]);
    expect(outcome.results.has("m2")).toBe(true);
    expect(calls.filter((call) => call.url.includes("/m1/"))).toHaveLength(1);
  });

  it("stops at the first expired-token answer and hands the error to the breaker", async () => {
    const { deps, calls } = httpDeps([
      {
        match: "/insights",
        reply: { status: 400, body: { error: { code: 190, message: "Error validating access token: Session has expired" } } }
      }
    ]);

    const outcome = await fetchInstagramMetrics(creds, media("m1", "m2", "m3"), deps);

    expect(outcome.stopped?.kind).toBe("auth");
    expect(calls).toHaveLength(1);
  });

  it("stops when Instagram says the app is rate limited", async () => {
    const { deps } = httpDeps([
      { match: "/insights", reply: { status: 400, body: { error: { code: 4, message: "(#4) Application request limit reached" } } } }
    ]);

    const outcome = await fetchInstagramMetrics(creds, media("m1", "m2"), deps);

    expect(outcome.stopped?.kind).toBe("rate");
  });

  it("stops with a budget stop when the run's calls are used, keeping what it read", async () => {
    const { deps, calls } = httpDeps([{ match: "/insights", reply: { body: insights({ views: 1, reach: 1, likes: 0, comments: 0, shares: 0, saved: 0 }) } }]);

    const outcome = await fetchInstagramMetrics(creds, media("m1", "m2", "m3", "m4"), deps, createPacer({ maxCalls: 2 }));

    expect(calls).toHaveLength(2);
    expect(outcome.results.size).toBe(2);
    expect(outcome.stopped).toMatchObject({ kind: "budget" });
  });

  it("stops above 75 percent of Meta's usage so publishing keeps its headroom", async () => {
    const { deps, calls } = httpDeps([
      {
        match: "/insights",
        reply: {
          headers: { "x-business-use-case-usage": JSON.stringify({ "1": [{ call_count: 82, total_cputime: 5, total_time: 5, estimated_time_to_regain_access: 0 }] }) },
          body: insights({ views: 1, reach: 1, likes: 0, comments: 0, shares: 0, saved: 0 })
        }
      }
    ]);

    const outcome = await fetchInstagramMetrics(creds, media("m1", "m2", "m3"), deps, createPacer({ maxCalls: 100 }));

    expect(calls).toHaveLength(1);
    expect(outcome.results.size).toBe(1);
    expect(outcome.stopped).toMatchObject({ kind: "rate", retryAfterMs: 3_600_000 });
  });
});
