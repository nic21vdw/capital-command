import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ChannelVideo } from "@/lib/publisher/channelVideos";
import {
  channelDuplicateGroups,
  findDuplicateInQueue,
  findDuplicateOnChannel,
  normalizeTitle,
  queueDuplicateGroups
} from "@/lib/publisher/duplicates";
import type { PlatformState, QueueItem } from "@/lib/publisher/types";

function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "a1",
    clipPath: "data/clips/job-1/clip-1.mp4",
    title: "I let Claude build my whole SaaS",
    caption: "",
    hashtags: [],
    publishAt: "2026-08-12T11:30:00.000Z",
    visibility: "public",
    createdAt: "2026-08-11T13:00:00.000Z",
    jobId: "job-1",
    platforms: { youtube: { status: "pending", attempts: 0 } as PlatformState },
    ...overrides
  };
}

const absolute = (relative: string) => path.resolve(process.cwd(), relative);

describe("a post the queue already carries", () => {
  it("is found by its file, however the path is spelled", () => {
    const found = findDuplicateInQueue({ paths: [absolute("data/clips/job-1/clip-1.mp4")] }, [item()]);
    expect(found?.reason).toBe("same-file");
    expect(found?.item.id).toBe("a1");
  });

  it("is found through the vertical render's original", () => {
    // The queued post is the 9:16 render; the caller offers the landscape master.
    const queued = item({ clipPath: "data/clips/job-1/clip-1.vertical.mp4", sourceClipPath: "data/clips/job-1/clip-1.mp4" });
    expect(findDuplicateInQueue({ paths: ["data/clips/job-1/clip-1.mp4"] }, [queued])?.reason).toBe("same-file");
  });

  it("is found when the same clip was re-rendered under a new name", () => {
    const found = findDuplicateInQueue(
      { paths: ["data/clips/job-1/clip-1.take2.mp4"], jobId: "job-1", title: "I Let Claude Build My Whole SaaS!" },
      [item()]
    );
    expect(found?.reason).toBe("same-title");
  });

  it("does not confuse the same title from a different job", () => {
    const found = findDuplicateInQueue(
      { paths: ["data/clips/job-9/clip-1.mp4"], jobId: "job-9", title: "I let Claude build my whole SaaS" },
      [item()]
    );
    expect(found).toBeUndefined();
  });

  it("finds every picture of a deck, not just the first", () => {
    const deck = item({ clipPath: "data/decks/d1/1.jpg", imagePaths: ["data/decks/d1/1.jpg", "data/decks/d1/2.jpg"] });
    expect(findDuplicateInQueue({ paths: ["data/decks/d1/2.jpg"] }, [deck])?.reason).toBe("same-file");
  });

  it("lets a fully-failed post be scheduled again", () => {
    const failed = item({ platforms: { youtube: { status: "failed", attempts: 5 } as PlatformState } });
    expect(findDuplicateInQueue({ paths: ["data/clips/job-1/clip-1.mp4"] }, [failed])).toBeUndefined();
  });

  it("still blocks when one platform failed and another is live", () => {
    const half = item({
      platforms: {
        youtube: { status: "published", attempts: 1 } as PlatformState,
        tiktok: { status: "failed", attempts: 5 } as PlatformState
      }
    });
    expect(findDuplicateInQueue({ paths: ["data/clips/job-1/clip-1.mp4"] }, [half])?.reason).toBe("same-file");
  });
});

describe("a video already on the channel", () => {
  const video = (overrides: Partial<ChannelVideo> = {}): ChannelVideo => ({
    videoId: "v1",
    title: "I let Claude build my whole SaaS",
    status: "published",
    publishAtUtc: "2026-08-09T14:00:00.000Z",
    thumbnailUrl: null,
    url: "https://www.youtube.com/watch?v=v1",
    ...overrides
  });
  const now = new Date("2026-08-11T13:00:00Z");

  it("matches past case, punctuation and emoji", () => {
    expect(findDuplicateOnChannel("I Let Claude Build My Whole SaaS! 🚀", [video()], now)?.videoId).toBe("v1");
  });

  it("does not match a merely similar title", () => {
    expect(findDuplicateOnChannel("I let Claude build my whole startup", [video()], now)).toBeUndefined();
  });

  it("ignores videos older than the window", () => {
    expect(findDuplicateOnChannel("I let Claude build my whole SaaS", [video({ publishAtUtc: "2026-01-01T14:00:00.000Z" })], now)).toBeUndefined();
  });

  it("catches one that is scheduled but not yet public", () => {
    const scheduled = video({ status: "scheduled", publishAtUtc: "2026-08-13T14:00:00.000Z" });
    expect(findDuplicateOnChannel("I let Claude build my whole SaaS", [scheduled], now)?.videoId).toBe("v1");
  });

  it("never matches on an empty title", () => {
    expect(normalizeTitle("🚀🚀")).toBe("");
    expect(findDuplicateOnChannel("🚀🚀", [video({ title: "✨" })], now)).toBeUndefined();
  });

  it("groups what is already up more than once, newest group first", () => {
    const groups = channelDuplicateGroups([
      video({ videoId: "old", publishAtUtc: "2026-08-01T14:00:00.000Z" }),
      video({ videoId: "new", publishAtUtc: "2026-08-09T14:00:00.000Z" }),
      video({ videoId: "solo", title: "Something else", publishAtUtc: "2026-08-10T14:00:00.000Z" })
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].videos.map((entry) => entry.videoId)).toEqual(["new", "old"]);
  });
});

describe("the queue's own duplicates", () => {
  it("reports a file booked twice, and a clip booked under two spellings", () => {
    const groups = queueDuplicateGroups([
      item({ id: "a", publishAt: "2026-08-12T11:30:00.000Z" }),
      item({ id: "b", publishAt: "2026-08-13T11:30:00.000Z" }),
      item({ id: "c", clipPath: "data/clips/job-2/clip-9.mp4", title: "A different short" }),
      item({ id: "d", clipPath: "data/clips/job-2/clip-8.mp4", title: "A Different Short!" })
    ]);
    const byReason = Object.fromEntries(groups.map((group) => [group.reason, group.items.map((entry) => entry.id)]));
    expect(byReason["same-file"]).toEqual(["a", "b"]);
    expect(byReason["same-title"]).toEqual(["c", "d"]);
  });

  it("says nothing about a queue with no repeats", () => {
    expect(
      queueDuplicateGroups([item({ id: "a" }), item({ id: "b", clipPath: "data/clips/job-2/x.mp4", title: "Other" })])
    ).toEqual([]);
  });
});
