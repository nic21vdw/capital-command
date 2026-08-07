import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PublishQueue } from "@/lib/publisher/queue";
import { runDue } from "@/lib/publisher/runner";
import { MemoryQueueStore, testConfig } from "@/lib/publisher/test-helpers";
import type { PlatformAdapter, PlatformId, PostResult, PublishInput } from "@/lib/publisher/types";

/**
 * The queue file on the running machine is full of video items written before
 * image posts existed. These tests keep both shapes honest through one runner:
 * a stored video item must load and publish exactly as it always did, and an
 * image item must reach its adapter with every picture, in order.
 */

vi.mock("@/lib/publisher/hosting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/publisher/hosting")>();
  return {
    ...actual,
    mediaHost: () => ({
      describe: () => "memory",
      upload: async (_local: string, key: string) => key,
      publicUrl: async (key: string) => `https://host.test/${key}`,
      download: async () => undefined,
      getObjectText: async () => null,
      putObjectText: async () => undefined,
      putObjectBytes: async () => undefined
    })
  };
});

const DUE = new Date("2026-07-10T22:31:00.000Z");
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "image-queue-"));
  await writeFile(path.join(dir, "clip.mp4"), Buffer.alloc(64, 1));
  await writeFile(path.join(dir, "slide-1.png"), Buffer.alloc(64, 2));
  await writeFile(path.join(dir, "slide-2.png"), Buffer.alloc(64, 3));
});

function recordingAdapter(id: PlatformId, result: PostResult): PlatformAdapter & { calls: PublishInput[] } {
  const calls: PublishInput[] = [];
  return {
    id,
    calls,
    configured: () => true,
    validateAuth: async () => undefined,
    buildPlan: (input) => ({
      platform: id,
      endpoint: "https://example.test",
      payload: {},
      publishAtLocal: "local",
      publishAtUtc: input.item.publishAt,
      notes: []
    }),
    publish: async (input) => {
      calls.push(input);
      return result;
    }
  };
}

/** Exactly the JSON an item written before image posts existed looks like. */
function legacyQueueJson(clipPath: string): string {
  return JSON.stringify([
    {
      id: "legacy1",
      clipPath,
      mediaKey: "publisher/media/legacy1/clip.mp4",
      title: "A clip from before all this",
      caption: "Still posting the same way",
      hashtags: ["#clips"],
      publishAt: "2026-07-10T22:30:00.000Z",
      visibility: "public",
      createdAt: "2026-07-01T00:00:00.000Z",
      jobId: "job1",
      platforms: { instagram: { status: "pending", attempts: 0 } }
    }
  ]);
}

describe("a video item stored before image posts existed", () => {
  it("loads and publishes exactly as it did, with no image plumbing attached", async () => {
    const store = new MemoryQueueStore();
    store.text = legacyQueueJson(path.join(dir, "clip.mp4"));
    const config = testConfig();
    const queue = new PublishQueue(store, config);
    const instagram = recordingAdapter("instagram", { status: "published", postId: "ig-1" });

    const report = await runDue(DUE, { queue, config, adapters: { instagram }, log: () => undefined });

    expect(report.outcomes).toEqual([
      { itemId: "legacy1", clip: path.join(dir, "clip.mp4"), platform: "instagram", outcome: "published", detail: "" }
    ]);
    const input = instagram.calls[0];
    expect(input.localPath).toBe(path.join(dir, "clip.mp4"));
    expect(input.images).toBeUndefined();
    expect(input.publicUrl).toBe("https://host.test/publisher/media/legacy1/clip.mp4");
    const stored = await queue.get("legacy1");
    expect(stored?.platforms.instagram?.status).toBe("published");
    expect(stored?.mediaKind).toBeUndefined();
    expect(stored?.imagePaths).toBeUndefined();
  });

  it("is never re-posted once it carries a postId", async () => {
    const store = new MemoryQueueStore();
    const legacy = JSON.parse(legacyQueueJson(path.join(dir, "clip.mp4")));
    legacy[0].platforms.instagram = { status: "uploaded", attempts: 1, postId: "ig-1" };
    store.text = JSON.stringify(legacy);
    const config = testConfig();
    const queue = new PublishQueue(store, config);
    const instagram = recordingAdapter("instagram", { status: "published", postId: "ig-should-not-happen" });

    await runDue(DUE, { queue, config, adapters: { instagram }, log: () => undefined });

    expect(instagram.calls).toHaveLength(0);
    expect((await queue.get("legacy1"))?.platforms.instagram?.postId).toBe("ig-1");
  });
});

describe("an image item through the same runner", () => {
  function imageQueueJson() {
    return JSON.stringify([
      {
        id: "deck1",
        mediaKind: "image",
        clipPath: path.join(dir, "slide-1.png"),
        imagePaths: [path.join(dir, "slide-1.png"), path.join(dir, "slide-2.png")],
        imageKeys: ["publisher/media/deck1/01-slide-1.png", "publisher/media/deck1/02-slide-2.png"],
        title: "Today's deck",
        caption: "Five things",
        hashtags: [],
        publishAt: "2026-07-10T22:30:00.000Z",
        visibility: "public",
        createdAt: "2026-07-01T00:00:00.000Z",
        platforms: { instagram: { status: "pending", attempts: 0 }, facebook: { status: "pending", attempts: 0 } }
      }
    ]);
  }

  it("hands every picture to each adapter, in order", async () => {
    const store = new MemoryQueueStore();
    store.text = imageQueueJson();
    const config = testConfig({ platforms: ["instagram", "facebook"] });
    const queue = new PublishQueue(store, config);
    const instagram = recordingAdapter("instagram", { status: "published", postId: "ig-deck" });
    const facebook = recordingAdapter("facebook", { status: "published", postId: "fb-deck" });

    await runDue(DUE, { queue, config, adapters: { instagram, facebook }, log: () => undefined });

    for (const adapter of [instagram, facebook]) {
      expect(adapter.calls[0].images?.publicUrls).toEqual([
        "https://host.test/publisher/media/deck1/01-slide-1.png",
        "https://host.test/publisher/media/deck1/02-slide-2.png"
      ]);
      expect(adapter.calls[0].images?.localPaths).toHaveLength(2);
    }
    const stored = await queue.get("deck1");
    expect(stored?.platforms.instagram?.postId).toBe("ig-deck");
    expect(stored?.platforms.facebook?.postId).toBe("fb-deck");
  });

  it("never re-posts a picture post that already has a postId", async () => {
    const store = new MemoryQueueStore();
    const deck = JSON.parse(imageQueueJson());
    deck[0].platforms.instagram = { status: "uploaded", attempts: 1, postId: "ig-deck", childContainerIds: ["c1", "c2"] };
    deck[0].platforms.facebook = { status: "published", attempts: 1, postId: "fb-deck" };
    store.text = JSON.stringify(deck);
    const config = testConfig({ platforms: ["instagram", "facebook"] });
    const queue = new PublishQueue(store, config);
    const instagram = recordingAdapter("instagram", { status: "published", postId: "ig-duplicate" });
    const facebook = recordingAdapter("facebook", { status: "published", postId: "fb-duplicate" });

    await runDue(DUE, { queue, config, adapters: { instagram, facebook }, log: () => undefined });

    expect(instagram.calls).toHaveLength(0);
    expect(facebook.calls).toHaveLength(0);
    const stored = await queue.get("deck1");
    expect(stored?.platforms.instagram?.postId).toBe("ig-deck");
    expect(stored?.platforms.instagram?.childContainerIds).toEqual(["c1", "c2"]);
  });
});
