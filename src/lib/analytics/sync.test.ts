import { rm } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readMetrics, metricsFile, updateMetrics } from "@/lib/analytics/store";
import { syncAnalytics, type AnalyticsCredentials, type SyncDeps } from "@/lib/analytics/sync";
import { httpDeps, type MockRoute } from "@/lib/analytics/test-helpers";
import type { Target } from "@/lib/analytics/types";
import { dataPath } from "@/lib/paths";
import { AUTH_PROBE_MINUTES, readAuthStates } from "@/lib/platform-health/store";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-13T12:00:00.000Z");
const GRAPH = "https://graph.facebook.com/v23.0";
const THREADS = "https://graph.threads.net/v1.0";

function target(platform: Target["platform"], postId: string, overrides: Partial<Target> = {}): Target {
  return {
    platform,
    accountId: platform === "threads" ? "primary" : `${platform}-primary`,
    postId,
    itemId: `item-${postId}`,
    format: platform === "threads" ? "text" : "video",
    title: `Title ${postId}`,
    caption: `Caption ${postId}`,
    publishedAt: "2026-10-10T15:00:00.000Z",
    ...overrides
  };
}

function credentials(overrides: Partial<AnalyticsCredentials> = {}): AnalyticsCredentials {
  return {
    youtube: async () => ({ token: "yt-token" }),
    instagram: async () => ({ token: "ig-token", graphBase: GRAPH }),
    facebook: async () => ({ token: "fb-token", graphBase: GRAPH }),
    threads: async () => ({ token: "th-token", base: THREADS }),
    tiktok: async () => ({ token: "tt-token" }),
    tiktokScopes: () => "user.info.basic,video.publish,video.upload",
    fingerprint: async (platform, accountId) => `fp:${platform}:${accountId}`,
    label: async () => null,
    ...overrides
  };
}

const idsParam = (url: string, name: string) => decodeURIComponent(new URL(url).searchParams.get(name) ?? "");

const youtubeRoutes: MockRoute[] = [
  {
    match: "youtubeanalytics.googleapis.com",
    reply: { status: 403, body: { error: { code: 403, errors: [{ reason: "insufficientPermissions" }] } } }
  },
  {
    match: "googleapis.com/youtube/v3/videos",
    reply: (call) => ({
      body: {
        items: idsParam(call.url, "id")
          .split(",")
          .map((id, index) => ({ id, statistics: { viewCount: String(500 + index), likeCount: "20", commentCount: "3" } }))
      }
    })
  }
];

const instagramRoutes: MockRoute[] = [
  {
    match: "/igmedia1/insights",
    reply: {
      body: {
        data: [
          { name: "views", values: [{ value: 300 }] },
          { name: "reach", values: [{ value: 250 }] },
          { name: "likes", values: [{ value: 30 }] },
          { name: "comments", values: [{ value: 4 }] },
          { name: "shares", values: [{ value: 2 }] },
          { name: "saved", values: [{ value: 6 }] }
        ]
      }
    }
  }
];

const facebookRoutes: MockRoute[] = [
  { match: "/fbvideo1/video_insights", reply: { body: { data: [{ name: "total_video_views", values: [{ value: 410 }] }] } } },
  { match: /\/fbvideo1\?fields=/, reply: { body: { likes: { summary: { total_count: 9 } }, comments: { summary: { total_count: 1 } } } } }
];

const threadsRoutes: MockRoute[] = [
  {
    match: "/th1/insights",
    reply: {
      body: {
        data: [
          { name: "views", values: [{ value: 90 }] },
          { name: "likes", values: [{ value: 7 }] },
          { name: "replies", values: [{ value: 1 }] },
          { name: "reposts", values: [{ value: 0 }] },
          { name: "quotes", values: [{ value: 0 }] },
          { name: "shares", values: [{ value: 0 }] }
        ]
      }
    }
  }
];

function setup(routes: MockRoute[], targets: Target[], overrides: Partial<SyncDeps> = {}) {
  const http = httpDeps(routes);
  const run = (now: Date, options: { force?: boolean } = {}, extra: Partial<SyncDeps> = {}) =>
    syncAnalytics({
      force: options.force,
      deps: {
        now: () => now,
        http: { ...http.deps, maxRetries: 1 },
        credentials: credentials(),
        loadTargets: async () => targets,
        ...overrides,
        ...extra
      }
    });
  return { ...http, run };
}

beforeEach(async () => {
  await rm(path.dirname(metricsFile()), { recursive: true, force: true });
  await rm(dataPath("platform-auth.json"), { force: true });
});

describe("syncAnalytics", () => {
  it("reads every platform's published posts into the store", async () => {
    const targets = [
      target("youtube", "ytvideo0001"),
      target("youtube", "ytvideo0002"),
      target("instagram", "igmedia1"),
      target("facebook", "fbvideo1"),
      target("threads", "th1")
    ];
    const { run, calls } = setup([...youtubeRoutes, ...instagramRoutes, ...facebookRoutes, ...threadsRoutes], targets);

    const report = await run(NOW);
    const store = await readMetrics();

    expect(report.status).toBe("ok");
    expect(store.posts["youtube:ytvideo0001"]).toMatchObject({
      status: "ok",
      source: "youtube-data-api",
      title: "Title ytvideo0001",
      latest: { metrics: { views: 500, likes: 20, comments: 3 } }
    });
    expect(store.posts["youtube:ytvideo0002"].latest?.metrics.views).toBe(501);
    expect(store.posts["instagram:igmedia1"]).toMatchObject({
      source: "instagram-insights",
      latest: { metrics: { views: 300, reach: 250, likes: 30, comments: 4, shares: 2, saves: 6 } }
    });
    expect(store.posts["facebook:fbvideo1"].latest?.metrics).toMatchObject({ views: 410, likes: 9, comments: 1 });
    expect(store.posts["threads:th1"]).toMatchObject({ source: "threads-insights", latest: { metrics: { views: 90, replies: 1 } } });
    expect(store.posts["youtube:ytvideo0001"].history).toEqual([
      { date: "2026-10-13", at: NOW.toISOString(), views: 500, likes: 20, comments: 3 }
    ]);
    expect(calls.filter((call) => call.url.includes("googleapis.com/youtube/v3/videos"))).toHaveLength(1);
    expect(store.sync).toMatchObject({ lastResult: "ok", lastCompletedAt: NOW.toISOString(), running: null });
    expect(Object.values(store.accounts).map((account) => `${account.key}=${account.status}`).sort()).toEqual([
      "facebook:facebook-primary=ok",
      "instagram:instagram-primary=ok",
      "threads:primary=ok",
      "youtube:youtube-primary=ok"
    ]);
  });

  it("marks TikTok unsupported while the app has no video.list scope, without calling TikTok", async () => {
    const { run, calls } = setup([], [target("tiktok", "7000000001")]);

    await run(NOW);
    const store = await readMetrics();

    expect(calls).toHaveLength(0);
    expect(store.posts["tiktok:7000000001"]).toMatchObject({ status: "unsupported", latest: null });
    expect(store.posts["tiktok:7000000001"].note).toMatch(/video\.list/);
    expect(store.accounts["tiktok:tiktok-primary"]).toMatchObject({ status: "unsupported" });
  });

  it("reads TikTok videos once the grant includes video.list", async () => {
    const routes: MockRoute[] = [
      { match: "/v2/video/query/", reply: { body: { data: { videos: [{ id: "7000000001", view_count: 12, like_count: 2, comment_count: 1, share_count: 0 }] }, error: { code: "ok" } } } }
    ];
    const { run } = setup(routes, [target("tiktok", "7000000001")], {
      credentials: credentials({ tiktokScopes: () => "user.info.basic,video.list" })
    });

    await run(NOW);

    expect((await readMetrics()).posts["tiktok:7000000001"]).toMatchObject({
      status: "ok",
      source: "tiktok-video-query",
      latest: { metrics: { views: 12, likes: 2 } }
    });
  });

  it("records an auth failure with the breaker, stops that account, and keeps the other platforms going", async () => {
    const routes: MockRoute[] = [
      { match: "googleapis.com", reply: { status: 401, body: { error: { code: 401, message: "Invalid Credentials" } } } },
      ...instagramRoutes
    ];
    const { run, calls } = setup(routes, [target("youtube", "ytvideo0001"), target("instagram", "igmedia1")]);

    const report = await run(NOW);

    const states = await readAuthStates();
    expect(Object.keys(states)).toEqual(["youtube:youtube-primary"]);
    expect(states["youtube:youtube-primary"].reason).toMatch(/Invalid Credentials/);
    const store = await readMetrics();
    expect(store.accounts["youtube:youtube-primary"]).toMatchObject({ status: "paused-auth" });
    expect(store.accounts["instagram:instagram-primary"]).toMatchObject({ status: "ok" });
    expect(store.posts["instagram:igmedia1"].latest).not.toBeNull();
    expect(store.posts["youtube:ytvideo0001"].latest).toBeNull();
    expect(report.status).toBe("partial");
    expect(calls.filter((call) => call.url.includes("googleapis.com"))).toHaveLength(1);
  });

  it("does not call a platform whose account the breaker is holding, until the next trial is due", async () => {
    let healthy = false;
    const { run, calls } = setup(
      [
        {
          match: "googleapis.com",
          reply: (call) => {
            if (!healthy) return { status: 401, body: { error: { message: "Invalid Credentials" } } };
            if (call.url.includes("youtubeanalytics")) return { status: 403, body: { error: { errors: [{ reason: "insufficientPermissions" }] } } };
            return { body: { items: [{ id: "ytvideo0001", statistics: { viewCount: "5" } }] } };
          }
        }
      ],
      [target("youtube", "ytvideo0001")]
    );

    await run(NOW, { force: true });
    const afterFirst = calls.length;
    await run(new Date(NOW.getTime() + 10 * MINUTE), { force: true });
    expect(calls.length).toBe(afterFirst);
    expect((await readMetrics()).accounts["youtube:youtube-primary"]).toMatchObject({ status: "paused-auth" });

    healthy = true;
    await run(new Date(NOW.getTime() + (AUTH_PROBE_MINUTES + 5) * MINUTE), { force: true });

    expect(calls.length).toBeGreaterThan(afterFirst);
    expect(await readAuthStates()).toEqual({});
    expect((await readMetrics()).accounts["youtube:youtube-primary"]).toMatchObject({ status: "ok" });
    expect((await readMetrics()).posts["youtube:ytvideo0001"].latest?.metrics.views).toBe(5);
  });

  it("trips the breaker when the token lookup itself is refused", async () => {
    const { run, calls } = setup([], [target("youtube", "ytvideo0001")], {
      credentials: credentials({
        youtube: async () => {
          throw new Error("YouTube connection expired or was revoked. Reconnect YouTube to resume the upload automatically.");
        }
      })
    });

    await run(NOW);

    expect(calls).toHaveLength(0);
    expect(Object.keys(await readAuthStates())).toEqual(["youtube:youtube-primary"]);
  });

  it("skips an account that is not connected without calling it a failure", async () => {
    const { run, calls } = setup([], [target("instagram", "igmedia1")], {
      credentials: credentials({ instagram: async () => null })
    });

    const report = await run(NOW);

    expect(calls).toHaveLength(0);
    expect((await readMetrics()).accounts["instagram:instagram-primary"]).toMatchObject({ status: "not-connected" });
    expect(report.status).toBe("ok");
    expect(await readAuthStates()).toEqual({});
  });

  it("backs off an account Meta is rate limiting, and leaves it alone until the wait is over", async () => {
    const limited: MockRoute = { match: "/igmedia1/insights", reply: { status: 429, headers: { "Retry-After": "7200" } } };
    const { run, calls } = setup([limited], [target("instagram", "igmedia1")]);

    await run(NOW, { force: true });
    const account = (await readMetrics()).accounts["instagram:instagram-primary"];

    expect(account.status).toBe("rate-limited");
    expect(account.backoffUntil).toBe(new Date(NOW.getTime() + 2 * HOUR).toISOString());
    const callsAfterFirst = calls.length;

    await run(new Date(NOW.getTime() + HOUR), { force: true });
    expect(calls.length).toBe(callsAfterFirst);

    await run(new Date(NOW.getTime() + 3 * HOUR), { force: true });
    expect(calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("notes a missing Threads insights permission on the account and retries on the next cycle", async () => {
    const denied: MockRoute = {
      match: "/insights",
      reply: { status: 400, body: { error: { code: 10, message: "(#10) Application does not have permission for this action" } } }
    };
    const { run } = setup([denied], [target("threads", "th1"), target("threads", "th2")]);

    const report = await run(NOW);
    const account = (await readMetrics()).accounts["threads:primary"];

    expect(account.status).toBe("unsupported");
    expect(account.note).toMatch(/threads_manage_insights/);
    expect(report.status).toBe("partial");
    expect(await readAuthStates()).toEqual({});
  });

  it("does not read a post again before it is due, but force does", async () => {
    const { run, calls } = setup(instagramRoutes, [target("instagram", "igmedia1")]);

    await run(NOW);
    await run(new Date(NOW.getTime() + HOUR));
    expect(calls).toHaveLength(1);

    await run(new Date(NOW.getTime() + HOUR), { force: true });
    expect(calls).toHaveLength(2);
    expect((await readMetrics()).posts["instagram:igmedia1"].history).toHaveLength(1);
  });

  it("adds one snapshot per day as days pass", async () => {
    const { run } = setup(instagramRoutes, [target("instagram", "igmedia1")]);

    await run(NOW);
    await run(new Date(NOW.getTime() + 1 * DAY));
    await run(new Date(NOW.getTime() + 2 * DAY));

    expect((await readMetrics()).posts["instagram:igmedia1"].history.map((snapshot) => snapshot.date)).toEqual([
      "2026-10-13",
      "2026-10-14",
      "2026-10-15"
    ]);
  });

  it("reads a post once more after its 90th day and never again", async () => {
    const old = target("instagram", "igmedia1", { publishedAt: new Date(NOW.getTime() - 89 * DAY).toISOString() });
    const { run, calls } = setup(instagramRoutes, [old]);

    await run(NOW);
    await run(new Date(NOW.getTime() + 2 * DAY));
    const beforeLater = calls.length;
    await run(new Date(NOW.getTime() + 5 * DAY));
    await run(new Date(NOW.getTime() + 40 * DAY), { force: true });

    expect(calls.length).toBe(beforeLater);
    expect((await readMetrics()).posts["instagram:igmedia1"].final).toBe(true);
  });

  it("gives a deleted video three misses before it stops reading it", async () => {
    const empty: MockRoute[] = [
      { match: "youtubeanalytics", reply: { status: 403, body: { error: { errors: [{ reason: "insufficientPermissions" }] } } } },
      { match: "googleapis.com/youtube/v3/videos", reply: { body: { items: [] } } }
    ];
    const { run, calls } = setup(empty, [target("youtube", "ytvideo0001")]);

    await run(NOW, { force: true });
    await run(new Date(NOW.getTime() + 6 * HOUR), { force: true });
    expect((await readMetrics()).posts["youtube:ytvideo0001"]).toMatchObject({ status: "ok", misses: 2 });
    await run(new Date(NOW.getTime() + 12 * HOUR), { force: true });
    expect((await readMetrics()).posts["youtube:ytvideo0001"]).toMatchObject({ status: "gone", misses: 3 });

    const before = calls.length;
    await run(new Date(NOW.getTime() + 18 * HOUR), { force: true });
    expect(calls.length).toBe(before);
  });

  it("runs once when two syncs are asked for at the same moment", async () => {
    const { run, calls } = setup(instagramRoutes, [target("instagram", "igmedia1")]);

    const [first, second] = await Promise.all([run(NOW), run(NOW)]);

    expect(calls).toHaveLength(1);
    expect(second).toBe(first);
  });

  it("says busy instead of starting while another live process is syncing", async () => {
    await updateMetrics((store) => {
      store.sync.running = { pid: process.ppid, startedAt: new Date(NOW.getTime() - 2 * MINUTE).toISOString() };
    });
    const { run, calls } = setup(instagramRoutes, [target("instagram", "igmedia1")]);

    const report = await run(NOW);

    expect(report.status).toBe("busy");
    expect(calls).toHaveLength(0);
  });

  it("takes over from a sync marker whose process is gone or that has run far too long", async () => {
    const { run, calls } = setup(instagramRoutes, [target("instagram", "igmedia1")]);

    await updateMetrics((store) => {
      store.sync.running = { pid: 2_000_000_000, startedAt: new Date(NOW.getTime() - 2 * MINUTE).toISOString() };
    });
    expect((await run(NOW)).status).toBe("ok");

    await updateMetrics((store) => {
      store.sync.running = { pid: process.ppid, startedAt: new Date(NOW.getTime() - 3 * HOUR).toISOString() };
    });
    expect((await run(new Date(NOW.getTime() + DAY))).status).toBe("ok");
    expect(calls).toHaveLength(2);
  });

  it("records a crash in the sync itself and clears its marker", async () => {
    const { run } = setup([], [], {
      loadTargets: async () => {
        throw new Error("The Threads queue could not be read.");
      }
    });

    const report = await run(NOW);

    expect(report.status).toBe("error");
    expect((await readMetrics()).sync).toMatchObject({ lastResult: "error", lastError: "The Threads queue could not be read.", running: null });
  });

  it("keeps a post's history when its title changes in the queue", async () => {
    const { run } = setup(instagramRoutes, [target("instagram", "igmedia1")]);
    await run(NOW);
    const renamed = target("instagram", "igmedia1", { title: "New title" });
    const second = setup(instagramRoutes, [renamed]);

    await second.run(new Date(NOW.getTime() + DAY));

    const post = (await readMetrics()).posts["instagram:igmedia1"];
    expect(post.title).toBe("New title");
    expect(post.history).toHaveLength(2);
  });
});
