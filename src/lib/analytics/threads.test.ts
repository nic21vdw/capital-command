import { describe, expect, it } from "vitest";
import { createPacer } from "@/lib/analytics/pacing";
import { fetchThreadsMetrics, parseThreadsInsights } from "@/lib/analytics/threads";
import { httpDeps } from "@/lib/analytics/test-helpers";

const creds = { token: "th-token", base: "https://graph.threads.net/v1.0" };

const posts = (...ids: string[]) => ids.map((id) => ({ id, kind: "TEXT" }));
const typed = (kind: string, ...ids: string[]) => ids.map((id) => ({ id, kind }));

function insights(values: Record<string, number>) {
  return { data: Object.entries(values).map(([name, value]) => ({ name, period: "lifetime", values: [{ value }] })) };
}

describe("parseThreadsInsights", () => {
  it("reads views, likes, replies, reposts, quotes and shares", () => {
    expect(parseThreadsInsights(insights({ views: 400, likes: 12, replies: 3, reposts: 2, quotes: 1, shares: 6 }))).toEqual({
      views: 400,
      likes: 12,
      replies: 3,
      reposts: 2,
      quotes: 1,
      shares: 6
    });
  });

  it("also reads the total_value form", () => {
    expect(parseThreadsInsights({ data: [{ name: "views", total_value: { value: 9 } }] })).toEqual({ views: 9 });
  });
});

describe("fetchThreadsMetrics", () => {
  it("asks for every metric with a bearer token", async () => {
    const { deps, calls } = httpDeps([
      { match: "/t1/insights", reply: { body: insights({ views: 10, likes: 1, replies: 0, reposts: 0, quotes: 0, shares: 0 }) } }
    ]);

    const outcome = await fetchThreadsMetrics(creds, posts("t1"), deps);

    expect(outcome.results.get("t1")?.source).toBe("threads-insights");
    expect(outcome.results.get("t1")?.metrics.views).toBe(10);
    expect(calls[0].headers.Authorization).toBe("Bearer th-token");
    expect(new URL(calls[0].url).searchParams.get("metric")).toBe("views,likes,replies,reposts,quotes,shares");
    expect(calls[0].url).not.toContain("th-token");
  });

  it("stops at the first answer saying the token lacks threads_manage_insights", async () => {
    const { deps, calls } = httpDeps([
      {
        match: "/insights",
        reply: { status: 400, body: { error: { code: 10, message: "(#10) Application does not have permission for this action" } } }
      }
    ]);

    const outcome = await fetchThreadsMetrics(creds, posts("t1", "t2", "t3"), deps);

    expect(outcome.stopped?.kind).toBe("scope");
    expect(outcome.notes.join(" ")).toMatch(/threads_manage_insights/);
    expect(calls).toHaveLength(1);
  });

  it("stops on an expired session", async () => {
    const { deps } = httpDeps([
      { match: "/insights", reply: { status: 401, body: { error: { message: "Session has expired", code: 190 } } } }
    ]);

    const outcome = await fetchThreadsMetrics(creds, posts("t1", "t2"), deps);

    expect(outcome.stopped?.kind).toBe("auth");
  });

  it("marks a deleted post gone and keeps reading the rest", async () => {
    const { deps } = httpDeps([
      { match: "/t1/insights", reply: { status: 404, body: { error: { message: "Unknown path components" } } } },
      { match: "/t2/insights", reply: { body: insights({ views: 4, likes: 0, replies: 0, reposts: 0, quotes: 0, shares: 0 }) } }
    ]);

    const outcome = await fetchThreadsMetrics(creds, posts("t1", "t2"), deps);

    expect(outcome.gone).toEqual(["t1"]);
    expect(outcome.results.has("t2")).toBe(true);
  });

  it("falls back for one refused post only: the next post of the same type still asks for every metric", async () => {
    const asked = (call: { url: string }) => new URL(call.url).searchParams.get("metric")!;
    const { deps, calls } = httpDeps([
      {
        match: "/insights",
        reply: (call) =>
          asked(call).includes("shares") && call.url.includes("/odd/")
            ? { status: 400, body: { error: { code: 100, message: "(#100) shares is not a valid metric" } } }
            : { body: insights({ views: 5, likes: 1, replies: 0, reposts: 0, quotes: 0 }) }
      }
    ]);

    const outcome = await fetchThreadsMetrics(creds, posts("odd", "t2", "t3"), deps);

    expect(outcome.results.size).toBe(3);
    expect(calls.map((call) => asked(call))).toEqual([
      "views,likes,replies,reposts,quotes,shares",
      "views,likes,replies,reposts,quotes",
      "views,likes,replies,reposts,quotes,shares",
      "views,likes,replies,reposts,quotes,shares"
    ]);
  });

  it("moves a post type to the shorter metric set only after two different posts of that type are refused", async () => {
    const asked = (call: { url: string }) => new URL(call.url).searchParams.get("metric")!;
    const { deps, calls } = httpDeps([
      {
        match: "/insights",
        reply: (call) =>
          asked(call).includes("shares")
            ? { status: 400, body: { error: { code: 100, message: "(#100) shares is not a valid metric" } } }
            : { body: insights({ views: 5, likes: 1, replies: 0, reposts: 0, quotes: 0 }) }
      }
    ]);

    await fetchThreadsMetrics(creds, posts("t1", "t2", "t3", "t4"), deps);

    expect(calls.filter((call) => asked(call).includes("shares"))).toHaveLength(2);
    expect(calls).toHaveLength(6);
  });

  it("keeps one post type's refusals from changing another's metric set", async () => {
    const asked = (call: { url: string }) => new URL(call.url).searchParams.get("metric")!;
    const { deps, calls } = httpDeps([
      {
        match: "/insights",
        reply: (call) =>
          asked(call).includes("shares") && call.url.includes("/text")
            ? { status: 400, body: { error: { code: 100, message: "(#100) shares is not a valid metric" } } }
            : { body: insights({ views: 5, likes: 1, replies: 0, reposts: 0, quotes: 0 }) }
      }
    ]);

    await fetchThreadsMetrics(creds, [...typed("TEXT", "text1", "text2", "text3"), ...typed("IMAGE", "image1")], deps);

    const imageCalls = calls.filter((call) => call.url.includes("/image1/"));
    expect(imageCalls).toHaveLength(1);
    expect(asked(imageCalls[0])).toContain("shares");
  });

  it("does not count a post's own 400 toward giving up on the account", async () => {
    const { deps, calls } = httpDeps([{ match: "/insights", reply: { status: 400, body: { error: { code: 100, message: "(#100) Invalid parameter" } } } }]);

    const outcome = await fetchThreadsMetrics(creds, posts("a", "b", "c", "d", "e", "f", "g"), { ...deps, maxRetries: 0 });

    expect(outcome.stopped).toBeNull();
    expect(outcome.failed).toHaveLength(7);
    expect(calls.length).toBeGreaterThanOrEqual(7);
  });

  it("gives up on an account after five failed reads in a row", async () => {
    const { deps, calls } = httpDeps([{ match: "/insights", reply: { status: 500, body: "boom" } }]);

    const outcome = await fetchThreadsMetrics(creds, posts("a", "b", "c", "d", "e", "f", "g"), { ...deps, maxRetries: 0 });

    expect(outcome.failed).toHaveLength(5);
    expect(outcome.stopped?.kind).toBe("errors");
    expect(calls).toHaveLength(5);
  });

  it("stops reading an account whose endpoint refuses ten posts in a row: it looks retired", async () => {
    const { deps, calls } = httpDeps([{ match: "/insights", reply: { status: 400, body: { error: { code: 100, message: "(#100) Unsupported request" } } } }]);

    const outcome = await fetchThreadsMetrics(creds, posts(...Array.from({ length: 14 }, (_, index) => `t${index}`)), deps);

    expect(outcome.failed).toHaveLength(10);
    expect(outcome.stopped).toMatchObject({ kind: "errors" });
    expect(outcome.stopped?.message).toMatch(/retired/);
    expect(calls.length).toBeLessThan(14 * 3);
  });

  it("does not call it retired when some posts get through between the refusals", async () => {
    const { deps } = httpDeps([
      {
        match: "/insights",
        reply: (call) =>
          Number(call.url.match(/\/t(\d+)\//)![1]) % 2 === 0
            ? { status: 400, body: { error: { code: 100, message: "(#100) Unsupported request" } } }
            : { body: insights({ views: 1, likes: 0 }) }
      }
    ]);

    const outcome = await fetchThreadsMetrics(creds, posts(...Array.from({ length: 24 }, (_, index) => `t${index}`)), deps);

    expect(outcome.stopped).toBeNull();
  });

  it("stops when it has used its calls for the run, keeping what it read", async () => {
    const { deps, calls } = httpDeps([{ match: "/insights", reply: { body: insights({ views: 1, likes: 0 }) } }]);

    const outcome = await fetchThreadsMetrics(creds, posts("a", "b", "c", "d"), deps, createPacer({ maxCalls: 2 }));

    expect(calls).toHaveLength(2);
    expect(outcome.results.size).toBe(2);
    expect(outcome.stopped).toMatchObject({ kind: "budget" });
  });
});
