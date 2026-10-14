import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectTargets, loadTargets } from "@/lib/analytics/targets";
import { dataPath } from "@/lib/paths";
import { testItem } from "@/lib/publisher/test-helpers";
import type { QueueItem } from "@/lib/publisher/types";
import type { ThreadsQueueItem } from "@/lib/threads/types";

function published(item: QueueItem, platform: "youtube" | "instagram" | "facebook" | "tiktok", postId: string, publishedAt = "2026-10-01T15:00:00.000Z"): QueueItem {
  return { ...item, platforms: { ...item.platforms, [platform]: { status: "published", postId, attempts: 1, publishedAt } } };
}

function threadsItem(overrides: Partial<ThreadsQueueItem> = {}): ThreadsQueueItem {
  return {
    id: "th-1",
    batchDate: "2026-10-01",
    slot: 1,
    accountId: "primary",
    version: "text",
    topic: "Tooling",
    format: "text",
    text: "A post about tooling",
    publishAt: "2026-10-01T14:00:00.000Z",
    status: "published",
    postId: "1789",
    publishedAt: "2026-10-01T14:01:00.000Z",
    attempts: 1,
    createdAt: "2026-09-30T00:00:00.000Z",
    ...overrides
  };
}

describe("collectTargets", () => {
  it("lists every published publish-queue leg that has a post id", () => {
    const item = published(published(testItem({ id: "a", platformIds: ["youtube", "instagram"] }), "youtube", "yt-abc"), "instagram", "ig-123");

    const targets = collectTargets({ publishItems: [item], threadsItems: [] });

    expect(targets).toEqual([
      expect.objectContaining({
        platform: "youtube",
        postId: "yt-abc",
        itemId: "a",
        accountId: "youtube-primary",
        title: "Test clip",
        caption: "A test caption",
        publishedAt: "2026-10-01T15:00:00.000Z",
        format: "video"
      }),
      expect.objectContaining({ platform: "instagram", postId: "ig-123", accountId: "instagram-primary" })
    ]);
  });

  it("leaves out legs that are not live or have no post id", () => {
    const pending = testItem({ id: "p", platformIds: ["youtube", "instagram", "tiktok", "facebook"] });
    const item: QueueItem = {
      ...pending,
      platforms: {
        youtube: { status: "scheduled", postId: "yt-sched", attempts: 1 },
        instagram: { status: "published", attempts: 1 },
        tiktok: { status: "failed", attempts: 3, error: "no" },
        facebook: { status: "uploaded", postId: "fb-1", attempts: 1 }
      }
    };

    expect(collectTargets({ publishItems: [item], threadsItems: [] })).toEqual([]);
  });

  it("keeps an added account's id and tells long-form, pictures and carousels apart", () => {
    const long = published(testItem({ id: "long", platformIds: ["youtube"], format: "long", accountId: "youtube-3f9a1c2d", visibility: "private" }), "youtube", "yt-long");
    const picture = published(
      testItem({ id: "pic", platformIds: ["instagram"], mediaKind: "image", imagePaths: ["data/uploads/photo.png"] }),
      "instagram",
      "ig-pic"
    );
    const deck = published(
      testItem({
        id: "deck",
        platformIds: ["facebook"],
        mediaKind: "image",
        imagePaths: ["data/carousels/car-9/slide-1.png", "data/carousels/car-9/slide-2.png"]
      }),
      "facebook",
      "fb-deck_1"
    );

    const [a, b, c] = collectTargets({ publishItems: [long, picture, deck], threadsItems: [] });

    expect(a).toMatchObject({ format: "long-form", accountId: "youtube-3f9a1c2d", visibility: "private" });
    expect(b).toMatchObject({ format: "image" });
    expect(c).toMatchObject({ format: "carousel", carouselId: "car-9" });
  });

  it("lists published Threads posts by their account", () => {
    const targets = collectTargets({
      publishItems: [],
      threadsItems: [threadsItem(), threadsItem({ id: "th-2", postId: undefined }), threadsItem({ id: "th-3", status: "failed" })]
    });

    expect(targets).toEqual([
      {
        platform: "threads",
        accountId: "primary",
        postId: "1789",
        itemId: "th-1",
        format: "text",
        title: "Tooling",
        caption: "A post about tooling",
        publishedAt: "2026-10-01T14:01:00.000Z"
      }
    ]);
  });

  it("lists a post once even when two queue items point at it", () => {
    const one = published(testItem({ id: "x", platformIds: ["youtube"] }), "youtube", "yt-same");
    const two = published(testItem({ id: "y", platformIds: ["youtube"] }), "youtube", "yt-same");

    expect(collectTargets({ publishItems: [one, two], threadsItems: [] })).toHaveLength(1);
  });
});

describe("loadTargets", () => {
  it("reads both queues from the data folder", async () => {
    const item = published(testItem({ id: "live", platformIds: ["youtube"] }), "youtube", "yt-live");
    await mkdir(dataPath(), { recursive: true });
    await writeFile(dataPath("publish-queue.json"), JSON.stringify([item]));
    await writeFile(path.join(dataPath(), "threads-queue.json"), JSON.stringify([threadsItem()]));

    const targets = await loadTargets();

    expect(targets.map((target) => `${target.platform}:${target.postId}`).sort()).toEqual(["threads:1789", "youtube:yt-live"]);
  });
});
