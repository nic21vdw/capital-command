import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { readAuthStates } from "@/lib/platform-health/store";
import { syncInbox } from "@/lib/inbox/sync";
import { readInbox, updateInbox } from "@/lib/inbox/store";
import { jsonResponse, samplePost, stubFetch, writeCalls, type FetchCall } from "@/lib/inbox/test-helpers";
import { cursorKey, emptyInbox } from "@/lib/inbox/types";

vi.mock("@/lib/publisher/adapters/youtube", () => ({ youtubeAccessToken: vi.fn(async () => "yt-token") }));
vi.mock("@/lib/publisher/metaProfile", () => ({
  instagramProfile: vi.fn(async () => ({ title: "CoLateral", handle: "colateral", thumbnail: null }))
}));

const NOW = new Date("2026-10-13T12:00:00.000Z");
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const yt = (id: string, at: string) => ({
  id,
  snippet: {
    channelId: "UC_me",
    videoId: "v",
    topLevelComment: { id, snippet: { authorDisplayName: `Viewer ${id}`, authorChannelId: { value: "UC_x" }, textDisplay: `yt ${id}`, publishedAt: at } }
  }
});

function platformApis(call: FetchCall): Response | null {
  const url = new URL(call.url);
  if (url.hostname === "www.googleapis.com") return jsonResponse({ items: [yt(`c-${url.searchParams.get("videoId")}`, daysAgo(1))] });
  if (url.hostname === "graph.threads.net" && url.pathname.endsWith("/me")) return jsonResponse({ id: "555", username: "nic_threads" });
  if (url.hostname === "graph.threads.net")
    return jsonResponse({ data: [{ id: "th-reply", text: "threads hello", username: "reader", timestamp: "2026-10-12T10:00:00+0000" }] });
  if (url.hostname === "graph.facebook.com" && url.pathname.includes("/ig-media/comments"))
    return jsonResponse({ data: [{ id: "ig-c", text: "ig hello", timestamp: "2026-10-12T10:00:00+0000", username: "fan" }] });
  if (url.hostname === "graph.facebook.com" && url.pathname.includes("/ig-media"))
    return jsonResponse({ permalink: "https://www.instagram.com/reel/XYZ/" });
  if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/comments"))
    return jsonResponse({ data: [{ id: "fb-c", message: "fb hello", created_time: "2026-10-12T10:00:00+0000", from: { id: "u1", name: "Sam" } }] });
  return null;
}

const ytPost = (postId: string, publishedAt = daysAgo(2)) => samplePost({ postId, publishedAt });
const threadsPost = samplePost({ platform: "threads", accountId: "primary", postId: "th-media", title: "a thought", publishedAt: daysAgo(1) });
const igPost = samplePost({ platform: "instagram", accountId: "instagram-primary", postId: "ig-media", publishedAt: daysAgo(1) });
const fbPost = samplePost({ platform: "facebook", accountId: "facebook-primary", postId: "fb-post", publishedAt: daysAgo(1) });

const yt403 = (reason: string, message: string) =>
  jsonResponse({ error: { code: 403, message, errors: [{ reason }] } }, 403);

beforeEach(async () => {
  vi.stubEnv("YOUTUBE_CLIENT_ID", "yt-id");
  vi.stubEnv("YOUTUBE_CLIENT_SECRET", "yt-secret");
  vi.stubEnv("YOUTUBE_REFRESH_TOKEN", "yt-refresh");
  vi.stubEnv("IG_USER_ID", "ig-user");
  vi.stubEnv("IG_ACCESS_TOKEN", "ig-token");
  vi.stubEnv("FB_PAGE_ID", "page1");
  vi.stubEnv("FB_PAGE_ACCESS_TOKEN", "fb-token");
  vi.stubEnv("THREADS_ACCESS_TOKEN", "th-token");
  vi.stubEnv("THREADS_USER_ID", "555");
  await updateInbox(() => emptyInbox());
  await rm(dataPath("platform-auth.json"), { force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("syncInbox", () => {
  it("collects comments from all four platforms, unread, with read-only calls", async () => {
    const calls = stubFetch((call) => platformApis(call) ?? jsonResponse({}, 404));

    const report = await syncInbox({ now: NOW, posts: [ytPost("v1"), threadsPost, igPost, fbPost] });

    const store = await readInbox();
    expect(store.items.map((item) => item.id).sort()).toEqual(["facebook:fb-c", "instagram:ig-c", "threads:th-reply", "youtube:c-v1"]);
    expect(store.items.every((item) => item.status === "new")).toBe(true);
    expect(report.added).toBe(4);
    expect(Object.values(report.platforms).map((entry) => entry?.status)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(writeCalls(calls)).toEqual([]);
    expect(store.cursors[cursorKey("youtube", "v1")]).toMatchObject({ lastFetchedAt: NOW.toISOString() });
    expect(store.items.find((item) => item.platform === "threads")?.postTitle).toBe("a thought");
  });

  it("asks only about posts from the last 30 days, plus older ones that have recent activity", async () => {
    const calls = stubFetch((call) => platformApis(call) ?? jsonResponse({}, 404));
    await updateInbox((store) => ({
      ...store,
      cursors: { [cursorKey("youtube", "busy")]: { lastActivityAt: daysAgo(1), lastFetchedAt: daysAgo(1) } }
    }));

    await syncInbox({
      now: NOW,
      posts: [ytPost("recent", daysAgo(5)), ytPost("ancient", daysAgo(45)), ytPost("busy", daysAgo(45))]
    });

    const asked = calls.map((call) => new URL(call.url).searchParams.get("videoId")).filter(Boolean).sort();
    expect(asked).toEqual(["busy", "recent"]);
  });

  it("is incremental: it remembers the newest comment per post and does not refetch before it is due", async () => {
    const page = [yt("n3", "2026-10-13T08:00:00Z"), yt("n2", "2026-10-12T08:00:00Z"), yt("n1", "2026-10-11T08:00:00Z")];
    let served = page.slice(1);
    const calls = stubFetch((call) => {
      const url = new URL(call.url);
      if (url.hostname !== "www.googleapis.com") return jsonResponse({}, 404);
      return url.searchParams.get("pageToken") ? jsonResponse({ items: [] }) : jsonResponse({ items: served, nextPageToken: "more" });
    });
    const posts = [ytPost("v1", daysAgo(1))];

    await syncInbox({ now: NOW, posts });
    expect((await readInbox()).cursors[cursorKey("youtube", "v1")].newestAt).toBe("2026-10-12T08:00:00.000Z");

    const callsAfterFirst = calls.length;
    await syncInbox({ now: new Date(NOW.getTime() + 60_000), posts });
    expect(calls.length).toBe(callsAfterFirst);

    served = page;
    await syncInbox({ now: new Date(NOW.getTime() + 3 * 3_600_000), posts });

    const store = await readInbox();
    expect(store.items.map((item) => item.externalId).sort()).toEqual(["n1", "n2", "n3"]);
    expect(store.cursors[cursorKey("youtube", "v1")].newestAt).toBe("2026-10-13T08:00:00.000Z");
    expect(calls.length - callsAfterFirst).toBe(1);
  });

  it("trips the platform-health breaker on an auth error and stops asking that platform until it may probe", async () => {
    const calls = stubFetch((call) =>
      new URL(call.url).hostname === "www.googleapis.com"
        ? jsonResponse({ error: { code: 401, message: "Invalid Credentials" } }, 401)
        : (platformApis(call) ?? jsonResponse({}, 404))
    );
    const posts = [ytPost("v1"), ytPost("v2"), threadsPost];

    const report = await syncInbox({ now: NOW, posts });

    expect(report.platforms.youtube?.status).toBe("needs-auth");
    expect(Object.keys(await readAuthStates())).toEqual(["youtube:youtube-primary"]);
    const store = await readInbox();
    expect(store.platforms.youtube).toMatchObject({ needs: "auth", message: "Reconnect YouTube" });
    expect(store.items.map((item) => item.platform)).toEqual(["threads"]);
    expect(calls.filter((call) => new URL(call.url).hostname === "www.googleapis.com")).toHaveLength(1);

    const before = calls.length;
    await syncInbox({ now: new Date(NOW.getTime() + 10 * 60_000), posts, force: true });
    expect(calls.slice(before).some((call) => new URL(call.url).hostname === "www.googleapis.com")).toBe(false);
  });

  it("says Reconnect <platform> with comment permission when the scope is missing, and does not trip the breaker", async () => {
    let missing = true;
    const calls = stubFetch((call) =>
      new URL(call.url).hostname === "www.googleapis.com" && missing
        ? yt403("insufficientPermissions", "Request had insufficient authentication scopes.")
        : (platformApis(call) ?? jsonResponse({}, 404))
    );
    const posts = [ytPost("v1"), ytPost("v2")];

    const report = await syncInbox({ now: NOW, posts });

    expect(report.platforms.youtube).toMatchObject({ status: "needs-scope", detail: "Reconnect YouTube with comment permission" });
    expect((await readInbox()).platforms.youtube).toMatchObject({ needs: "scope", message: "Reconnect YouTube with comment permission" });
    expect(await readAuthStates()).toEqual({});
    expect(calls).toHaveLength(1);

    await syncInbox({ now: new Date(NOW.getTime() + 35 * 60_000), posts });
    expect(calls).toHaveLength(1);

    missing = false;
    await syncInbox({ now: new Date(NOW.getTime() + 40 * 60_000), posts, force: true });
    const store = await readInbox();
    expect(store.platforms.youtube?.needs).toBeUndefined();
    expect(store.items.length).toBeGreaterThan(0);
  });

  it("detects a missing scope on Meta and Threads too", async () => {
    stubFetch((call) => {
      const url = new URL(call.url);
      if (url.hostname === "graph.threads.net" && url.pathname.endsWith("/me")) return jsonResponse({ id: "555", username: "nic_threads" });
      if (url.hostname === "graph.threads.net")
        return jsonResponse({ error: { message: "(#10) Application does not have permission for this action", type: "THApiException", code: 10 } }, 403);
      return jsonResponse(
        { error: { message: "(#10) This endpoint requires the 'instagram_manage_comments' permission", type: "OAuthException", code: 10 } },
        400
      );
    });

    const report = await syncInbox({ now: NOW, posts: [threadsPost, igPost] });

    expect(report.platforms.threads?.detail).toBe("Reconnect Threads with comment permission");
    expect(report.platforms.instagram?.detail).toBe("Reconnect Instagram with comment permission");
  });

  it("keeps going when one video has comments switched off", async () => {
    stubFetch((call) => {
      const url = new URL(call.url);
      if (url.hostname !== "www.googleapis.com") return jsonResponse({}, 404);
      return url.searchParams.get("videoId") === "off"
        ? yt403("commentsDisabled", "The video identified by the videoId parameter has disabled comments.")
        : jsonResponse({ items: [yt("ok-1", daysAgo(1))] });
    });

    const report = await syncInbox({ now: NOW, posts: [ytPost("off"), ytPost("on")] });

    expect(report.platforms.youtube?.status).toBe("ok");
    expect((await readInbox()).items.map((item) => item.externalId)).toEqual(["ok-1"]);
  });

  it("runs once at a time: a second caller shares the sync already in flight", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = stubFetch(async (call) => {
      await gate;
      return platformApis(call) ?? jsonResponse({}, 404);
    });

    const first = syncInbox({ now: NOW, posts: [ytPost("v1")] });
    const second = syncInbox({ now: NOW, posts: [ytPost("v1")] });
    release();

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(calls.filter((call) => new URL(call.url).hostname === "www.googleapis.com")).toHaveLength(1);
  });

  it("keeps YouTube reads inside a small daily quota budget so uploads are never starved", async () => {
    vi.stubEnv("INBOX_YOUTUBE_DAILY_UNITS", "2");
    const calls = stubFetch((call) => platformApis(call) ?? jsonResponse({}, 404));

    const report = await syncInbox({ now: NOW, posts: [ytPost("v1"), ytPost("v2"), ytPost("v3")] });

    expect(calls.filter((call) => new URL(call.url).hostname === "www.googleapis.com")).toHaveLength(2);
    expect(report.platforms.youtube).toMatchObject({ status: "deferred", fetchedPosts: 2 });
    expect((await readInbox()).youtubeUnits?.used).toBe(2);
  });

  it("leaves a platform with no credentials alone", async () => {
    vi.stubEnv("YOUTUBE_REFRESH_TOKEN", "");
    vi.stubEnv("YOUTUBE_CLIENT_ID", "");
    const calls = stubFetch(() => jsonResponse({}, 404));

    const report = await syncInbox({ now: NOW, posts: [ytPost("v1")] });

    expect(report.platforms.youtube?.status).toBe("not-connected");
    expect(calls).toHaveLength(0);
  });
});
