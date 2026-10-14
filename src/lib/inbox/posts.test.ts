import { beforeEach, describe, expect, it, vi } from "vitest";
import { listPublishedPosts } from "@/lib/inbox/posts";
import { newPlatformState } from "@/lib/publisher/queue";
import type { QueueItem } from "@/lib/publisher/types";
import type { ThreadsQueueItem } from "@/lib/threads/types";

const queued = vi.hoisted(() => ({ items: [] as unknown[], threads: [] as unknown[] }));

vi.mock("@/lib/publisher/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/publisher/queue")>()),
  publishQueue: () => ({ list: async () => queued.items })
}));
vi.mock("@/lib/threads/queue", () => ({ readQueue: async () => queued.threads }));


function queueItem(overrides: Partial<QueueItem> & { platforms: QueueItem["platforms"] }): QueueItem {
  return {
    id: "q1",
    clipPath: "data/clips/a.mp4",
    title: "A clip",
    caption: "",
    hashtags: [],
    publishAt: "2026-10-10T12:00:00.000Z",
    visibility: "public",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides
  };
}

const published = (postId: string, publishedAt = "2026-10-10T12:01:00.000Z") => ({
  ...newPlatformState(),
  status: "published" as const,
  postId,
  publishedAt
});

beforeEach(() => {
  queued.items = [];
  queued.threads = [];
});

describe("listPublishedPosts", () => {
  it("lists published posts per platform with their ids, titles and publish times", async () => {
    queued.items = [
      queueItem({ platforms: { youtube: published("yt1"), instagram: published("ig1"), facebook: published("fb1") } })
    ];

    const posts = await listPublishedPosts();

    expect(posts.map((post) => `${post.platform}:${post.postId}`).sort()).toEqual(["facebook:fb1", "instagram:ig1", "youtube:yt1"]);
    expect(posts.find((post) => post.platform === "youtube")).toMatchObject({
      accountId: "youtube-primary",
      title: "A clip",
      publishedAt: "2026-10-10T12:01:00.000Z",
      url: "https://www.youtube.com/watch?v=yt1"
    });
  });

  it("leaves out legs that are not live: pending, scheduled, failed, manual", async () => {
    queued.items = [
      queueItem({
        platforms: {
          youtube: { ...newPlatformState(), status: "scheduled", postId: "yt-sched" },
          instagram: { ...newPlatformState(), status: "failed", postId: "ig-failed" },
          facebook: { ...newPlatformState(), status: "pending" }
        }
      })
    ];

    expect(await listPublishedPosts()).toEqual([]);
  });

  it("leaves out private YouTube uploads and accounts the app has no credentials for", async () => {
    queued.items = [
      queueItem({ id: "q-private", visibility: "private", platforms: { youtube: published("yt-private") } }),
      queueItem({ id: "q-extra", accountId: "ig-extra", platforms: { instagram: published("ig-extra-media") } }),
      queueItem({ id: "q-yt-extra", accountId: "yt-second", platforms: { youtube: published("yt-second-vid") } })
    ];

    const posts = await listPublishedPosts();

    expect(posts.map((post) => post.postId)).toEqual(["yt-second-vid"]);
    expect(posts[0].accountId).toBe("yt-second");
  });

  it("includes published Threads posts by account", async () => {
    queued.threads = [
      {
        id: "t1",
        accountId: "secondary",
        text: "a very long thought ".repeat(10),
        publishAt: "2026-10-12T10:00:00.000Z",
        publishedAt: "2026-10-12T10:00:30.000Z",
        status: "published",
        postId: "th-media-1"
      },
      { id: "t2", accountId: "primary", text: "waiting", publishAt: "2026-10-14T10:00:00.000Z", status: "pending" }
    ] as ThreadsQueueItem[];

    const posts = await listPublishedPosts();

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ platform: "threads", accountId: "secondary", postId: "th-media-1", publishedAt: "2026-10-12T10:00:30.000Z" });
    expect(posts[0].title.length).toBeLessThanOrEqual(80);
  });

  it("lists a post that went out on two items only once", async () => {
    queued.items = [
      queueItem({ id: "a", platforms: { youtube: published("same") } }),
      queueItem({ id: "b", platforms: { youtube: published("same") } })
    ];

    expect(await listPublishedPosts()).toHaveLength(1);
  });
});
