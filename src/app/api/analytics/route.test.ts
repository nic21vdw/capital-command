import { rm } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/analytics/route";
import { metricsFile, updateMetrics } from "@/lib/analytics/store";
import type { AnalyticsReport } from "@/lib/analytics/api";
import type { MetricValues, PostRecord } from "@/lib/analytics/types";

const DAY = 86_400_000;

function record(platform: PostRecord["platform"], postId: string, daysAgo: number, metrics: MetricValues): PostRecord {
  return {
    key: `${platform}:${postId}`,
    platform,
    accountId: `${platform}-primary`,
    postId,
    itemId: `item-${postId}`,
    format: "video",
    title: `Title ${postId}`,
    caption: "",
    publishedAt: new Date(Date.now() - daysAgo * DAY).toISOString(),
    status: "ok",
    source: platform === "youtube" ? "youtube-data-api" : "instagram-insights",
    latest: { at: new Date().toISOString(), metrics },
    history: [],
    misses: 0
  };
}

async function seed() {
  await updateMetrics((store) => {
    for (const entry of [
      record("youtube", "yt-a", 1, { views: 1000, likes: 50, comments: 10 }),
      record("youtube", "yt-b", 10, { views: 5000, likes: 100, comments: 20 }),
      record("youtube", "yt-c", 60, { views: 200, likes: 2, comments: 0 }),
      record("instagram", "ig-a", 2, { views: 800, reach: 600, likes: 80, comments: 8, shares: 4, saves: 8 })
    ]) {
      store.posts[entry.key] = entry;
    }
    store.accounts["youtube:youtube-primary"] = {
      key: "youtube:youtube-primary",
      platform: "youtube",
      accountId: "youtube-primary",
      label: null,
      status: "ok",
      note: "Watch time needs the yt-analytics.readonly scope.",
      at: new Date().toISOString(),
      source: "youtube-data-api",
      posts: 3
    };
    store.sync.lastCompletedAt = new Date().toISOString();
    store.sync.lastAttemptAt = store.sync.lastCompletedAt;
    store.sync.lastResult = "ok";
  });
}

async function get(query = ""): Promise<{ status: number; body: AnalyticsReport & { error?: string }; headers: Headers }> {
  const response = await GET(new NextRequest(`http://127.0.0.1:3000/api/analytics${query}`));
  return { status: response.status, body: await response.json(), headers: response.headers };
}

beforeEach(async () => {
  await rm(path.dirname(metricsFile()), { recursive: true, force: true });
});

describe("GET /api/analytics", () => {
  it("answers with no posts and a sync that never ran before anything is synced", async () => {
    const { status, body } = await get();

    expect(status).toBe(200);
    expect(body.posts).toEqual([]);
    expect(body.sync).toMatchObject({ lastCompletedAt: null, lastResult: null, running: false });
    expect(body.totals).toEqual({ last7: [], last28: [] });
  });

  it("returns every post with its numbers, newest first, and says it must not be cached", async () => {
    await seed();

    const { body, headers } = await get();

    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(body.posts.map((post) => post.postId)).toEqual(["yt-a", "ig-a", "yt-b", "yt-c"]);
    expect(body.posts[0]).toMatchObject({
      platform: "youtube",
      title: "Title yt-a",
      metrics: { views: 1000, likes: 50, comments: 10 },
      source: "youtube-data-api"
    });
    expect(body.posts[0].engagementRate).toBeCloseTo(0.06);
    expect(body.accounts[0]).toMatchObject({ platform: "youtube", status: "ok", note: expect.stringContaining("yt-analytics.readonly") });
    expect(body.sync.lastResult).toBe("ok");
    expect(typeof body.sync.nextDueAt).toBe("string");
  });

  it("filters by platform", async () => {
    await seed();

    const { body } = await get("?platform=instagram");

    expect(body.posts.map((post) => post.postId)).toEqual(["ig-a"]);
  });

  it("filters by platform list and by since", async () => {
    await seed();

    expect((await get("?platform=youtube,instagram&since=28d")).body.posts.map((post) => post.postId)).toEqual(["yt-a", "ig-a", "yt-b"]);
    expect((await get("?since=7d")).body.posts.map((post) => post.postId)).toEqual(["yt-a", "ig-a"]);
  });

  it("returns the top N by views", async () => {
    await seed();

    const { body } = await get("?top=2");

    expect(body.posts.map((post) => post.postId)).toEqual(["yt-b", "yt-a"]);
  });

  it("reports last-7 and last-28 day totals per platform, whatever the other filters are", async () => {
    await seed();

    const { body } = await get("?top=1");

    const youtube7 = body.totals.last7.find((entry) => entry.platform === "youtube")!;
    const youtube28 = body.totals.last28.find((entry) => entry.platform === "youtube")!;
    expect(youtube7).toMatchObject({ posts: 1, views: 1000 });
    expect(youtube28).toMatchObject({ posts: 2, views: 6000 });
    expect(body.totals.last7.find((entry) => entry.platform === "instagram")).toMatchObject({ views: 800, saves: 8 });
  });

  it("rejects a platform it does not know and a top that is not a number", async () => {
    expect((await get("?platform=myspace")).status).toBe(400);
    expect((await get("?top=lots")).status).toBe(400);
    expect((await get("?top=0")).status).toBe(400);
    expect((await get("?since=soon")).status).toBe(400);
  });

  it("answers 500 with a reason when the store cannot be read, rather than an empty page", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(path.dirname(metricsFile()), { recursive: true });
    await writeFile(metricsFile(), "{ nope");

    const { status, body } = await get();

    expect(status).toBe(500);
    expect(body.error).toMatch(/metrics\.json/);
  });
});
