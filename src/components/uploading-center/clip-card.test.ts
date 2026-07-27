import { describe, expect, it } from "vitest";
import {
  appendHashtag,
  summarizePlatformState,
  SUGGESTED_HASHTAGS,
  TITLE_MAX_LENGTH
} from "@/components/uploading-center/clip-card";
import type { PlatformState } from "@/lib/publisher/types";

describe("appendHashtag", () => {
  it("appends with a separating space", () => {
    expect(appendHashtag("My clip", "#AI")).toBe("My clip #AI");
  });

  it("uses the hashtag alone when the title is empty", () => {
    expect(appendHashtag("", "#coding")).toBe("#coding");
  });

  it("does not double up whitespace on titles with trailing spaces", () => {
    expect(appendHashtag("My clip ", "#AI")).toBe("My clip #AI");
  });

  it("leaves the title unchanged when the hashtag would exceed the limit", () => {
    const long = "x".repeat(TITLE_MAX_LENGTH - 2);
    expect(appendHashtag(long, "#business")).toBe(long);
  });

  it("never produces a title over the limit for any suggested hashtag", () => {
    for (const hashtag of SUGGESTED_HASHTAGS) {
      for (const length of [0, 50, 90, TITLE_MAX_LENGTH]) {
        expect(appendHashtag("y".repeat(length), hashtag).length).toBeLessThanOrEqual(TITLE_MAX_LENGTH);
      }
    }
  });
});

describe("summarizePlatformState", () => {
  const item = { publishAt: "2026-07-15T19:30:00.000Z", createdAt: "2026-07-14T10:00:00.000Z" };
  const state = (over: Partial<PlatformState>): PlatformState => ({ status: "pending", attempts: 0, ...over });

  it("confirms the upload day for a scheduled YouTube post", () => {
    const summary = summarizePlatformState(
      "youtube",
      state({ status: "scheduled", postId: "vid123", uploadedAt: "2026-07-14T10:00:05.000Z" }),
      item
    );
    expect(summary.uploaded).toMatch(/^Uploaded /);
    expect(summary.note).toMatch(/^Goes live /);
  });

  it("falls back to createdAt when an uploaded post predates the uploadedAt stamp", () => {
    const summary = summarizePlatformState("youtube", state({ status: "scheduled", postId: "vid123" }), item);
    expect(summary.uploaded).toMatch(/^Uploaded /);
  });

  it("shows no upload confirmation before anything is sent", () => {
    expect(summarizePlatformState("youtube", state({ status: "pending" }), item).uploaded).toBeNull();
    expect(summarizePlatformState("tiktok", state({ status: "manual" }), item).uploaded).toBeNull();
  });

  it("surfaces the failure reason instead of an upload day", () => {
    const summary = summarizePlatformState("youtube", state({ status: "failed", error: "quota exceeded" }), item);
    expect(summary.uploaded).toBeNull();
    expect(summary.note).toContain("quota exceeded");
  });

  it("reports a published post as live", () => {
    const summary = summarizePlatformState(
      "youtube",
      state({ status: "published", postId: "vid123", uploadedAt: "2026-07-14T10:00:05.000Z", publishedAt: "2026-07-15T19:30:00.000Z" }),
      item
    );
    expect(summary.uploaded).toMatch(/^Uploaded /);
    expect(summary.note).toMatch(/^Live since /);
  });
});
