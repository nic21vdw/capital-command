import { describe, expect, it } from "vitest";
import { fetchThreadsMetrics, parseThreadsInsights } from "@/lib/analytics/threads";
import { httpDeps } from "@/lib/analytics/test-helpers";

const creds = { token: "th-token", base: "https://graph.threads.net/v1.0" };

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

    const outcome = await fetchThreadsMetrics(creds, ["t1"], deps);

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

    const outcome = await fetchThreadsMetrics(creds, ["t1", "t2", "t3"], deps);

    expect(outcome.stopped?.kind).toBe("scope");
    expect(outcome.notes.join(" ")).toMatch(/threads_manage_insights/);
    expect(calls).toHaveLength(1);
  });

  it("stops on an expired session", async () => {
    const { deps } = httpDeps([
      { match: "/insights", reply: { status: 401, body: { error: { message: "Session has expired", code: 190 } } } }
    ]);

    const outcome = await fetchThreadsMetrics(creds, ["t1", "t2"], deps);

    expect(outcome.stopped?.kind).toBe("auth");
  });

  it("marks a deleted post gone and keeps reading the rest", async () => {
    const { deps } = httpDeps([
      { match: "/t1/insights", reply: { status: 404, body: { error: { message: "Unknown path components" } } } },
      { match: "/t2/insights", reply: { body: insights({ views: 4, likes: 0, replies: 0, reposts: 0, quotes: 0, shares: 0 }) } }
    ]);

    const outcome = await fetchThreadsMetrics(creds, ["t1", "t2"], deps);

    expect(outcome.gone).toEqual(["t1"]);
    expect(outcome.results.has("t2")).toBe(true);
  });

  it("gives up on an account after five failed reads in a row", async () => {
    const { deps, calls } = httpDeps([{ match: "/insights", reply: { status: 500, body: "boom" } }]);

    const outcome = await fetchThreadsMetrics(creds, ["a", "b", "c", "d", "e", "f", "g"], { ...deps, maxRetries: 0 });

    expect(outcome.failed).toHaveLength(5);
    expect(outcome.stopped?.kind).toBe("errors");
    expect(calls).toHaveLength(5);
  });
});
