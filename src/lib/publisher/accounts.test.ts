import { describe, expect, it } from "vitest";
import {
  isPrimaryAccountId,
  itemAccountId,
  itemBelongsToAccount,
  primaryAccountId,
  withPrimaries,
  youtubeChannelKey,
  youtubeRefreshTokenKey,
  type SocialAccount
} from "@/lib/publisher/accounts";
import { newPlatformState } from "@/lib/publisher/queue";
import type { QueueItem } from "@/lib/publisher/types";

function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "abc12345",
    clipPath: "data/clips/outputs/job/clip.mp4",
    title: "t",
    caption: "c",
    hashtags: [],
    publishAt: "2026-07-15T16:30:00.000Z",
    visibility: "public",
    createdAt: "2026-07-12T00:00:00.000Z",
    platforms: { youtube: newPlatformState() },
    ...overrides
  };
}

describe("primary accounts", () => {
  it("recognizes every platform's primary id and nothing else", () => {
    expect(primaryAccountId("youtube")).toBe("youtube-primary");
    expect(isPrimaryAccountId("youtube-primary")).toBe(true);
    expect(isPrimaryAccountId("tiktok-primary")).toBe(true);
    expect(isPrimaryAccountId("youtube-a1b2c3d4")).toBe(false);
  });

  it("keeps the original token-cache keys for the primary YouTube account", () => {
    expect(youtubeRefreshTokenKey()).toBe("youtube.refreshToken");
    expect(youtubeRefreshTokenKey("youtube-primary")).toBe("youtube.refreshToken");
    expect(youtubeChannelKey("youtube-primary")).toBe("youtube.channel");
    expect(youtubeRefreshTokenKey("youtube-x1")).toBe("youtube.refreshToken.youtube-x1");
    expect(youtubeChannelKey("youtube-x1")).toBe("youtube.channel.youtube-x1");
  });
});

describe("withPrimaries", () => {
  it("always yields one primary per platform, ordered platform-first then oldest-first", () => {
    const extra: SocialAccount = {
      id: "youtube-x1",
      platform: "youtube",
      label: "Clips channel",
      createdAt: "2026-07-01T00:00:00.000Z"
    };
    const list = withPrimaries([extra]);
    expect(list.filter((a) => a.platform === "youtube").map((a) => a.id)).toEqual(["youtube-primary", "youtube-x1"]);
    expect(list.filter((a) => isPrimaryAccountId(a.id))).toHaveLength(4);
  });

  it("drops stored entries that collide with a primary id or use an unknown platform", () => {
    const bogus = [
      { id: "youtube-primary", platform: "youtube", label: "impostor", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "x-1", platform: "myspace", label: "old", createdAt: "2026-01-01T00:00:00.000Z" }
    ] as SocialAccount[];
    const list = withPrimaries(bogus);
    expect(list).toHaveLength(4);
    expect(list.find((a) => a.id === "youtube-primary")?.label).toBe("Primary");
  });
});

describe("queue item ↔ account matching", () => {
  it("legacy items without accountId belong to the platform's primary account", () => {
    const legacy = item();
    expect(itemAccountId(legacy, "youtube")).toBe("youtube-primary");
    expect(itemBelongsToAccount(legacy, "youtube", "youtube-primary")).toBe(true);
    expect(itemBelongsToAccount(legacy, "youtube", "youtube-x1")).toBe(false);
  });

  it("items with an accountId belong only to that account, and only on their platforms", () => {
    const tagged = item({ accountId: "youtube-x1" });
    expect(itemBelongsToAccount(tagged, "youtube", "youtube-x1")).toBe(true);
    expect(itemBelongsToAccount(tagged, "youtube", "youtube-primary")).toBe(false);
    // The item has no tiktok platform state at all.
    expect(itemBelongsToAccount(tagged, "tiktok", "youtube-x1")).toBe(false);
  });
});
