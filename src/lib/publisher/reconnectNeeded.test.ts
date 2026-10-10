import { describe, expect, it } from "vitest";
import { needsReconnect } from "./reconnectNeeded";
import type { PlatformId, PlatformState, QueueItem } from "./types";

function item(id: string, publishAt: string, state: PlatformState, platform: PlatformId = "youtube", accountId?: string): QueueItem {
  return {
    id,
    clipPath: `${id}.mp4`,
    title: id,
    caption: "",
    hashtags: [],
    publishAt,
    visibility: "public",
    createdAt: publishAt,
    accountId,
    platforms: { [platform]: state }
  };
}

const revoked: PlatformState = { status: "failed", attempts: 1, error: "invalid_grant: Token has been expired or revoked." };
const rejected: PlatformState = { status: "failed", attempts: 1, error: "YouTube rejected the video: duplicate content" };
const published = (publishedAt: string): PlatformState => ({ status: "published", attempts: 1, publishedAt });

describe("whether a connected account needs reconnecting", () => {
  it("is true when the latest finished post died on the connection", () => {
    expect(needsReconnect([item("a", "2026-10-01T10:00:00Z", revoked)], "youtube", "youtube-primary")).toBe(true);
  });

  it("is false for a post the platform rejected on its merits", () => {
    expect(needsReconnect([item("a", "2026-10-01T10:00:00Z", rejected)], "youtube", "youtube-primary")).toBe(false);
  });

  it("recovers once a later post goes out", () => {
    const items = [
      item("a", "2026-10-01T10:00:00Z", revoked),
      item("b", "2026-10-02T10:00:00Z", published("2026-10-02T10:00:05Z"))
    ];
    expect(needsReconnect(items, "youtube", "youtube-primary")).toBe(false);
  });

  it("does not let an older success hide a newer failure", () => {
    const items = [
      item("a", "2026-10-01T10:00:00Z", published("2026-10-01T10:00:05Z")),
      item("b", "2026-10-02T10:00:00Z", revoked)
    ];
    expect(needsReconnect(items, "youtube", "youtube-primary")).toBe(true);
  });

  it("ignores manual and pending posts, which say nothing about the connection", () => {
    const items = [
      item("a", "2026-10-01T10:00:00Z", { status: "manual", attempts: 0 }),
      item("b", "2026-10-02T10:00:00Z", { status: "pending", attempts: 1, error: "invalid_grant" })
    ];
    expect(needsReconnect(items, "youtube", "youtube-primary")).toBe(false);
  });

  it("only counts the account and platform asked about", () => {
    const items = [
      item("a", "2026-10-01T10:00:00Z", revoked, "youtube", "youtube-abc"),
      item("b", "2026-10-01T11:00:00Z", revoked, "tiktok")
    ];
    expect(needsReconnect(items, "youtube", "youtube-primary")).toBe(false);
    expect(needsReconnect(items, "youtube", "youtube-abc")).toBe(true);
    expect(needsReconnect(items, "tiktok", "tiktok-primary")).toBe(true);
  });
});
