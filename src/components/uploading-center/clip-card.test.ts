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
  const zone = "America/Toronto";
  const item = { publishAt: "2026-07-15T19:30:00.000Z", createdAt: "2026-07-14T10:00:00.000Z" };
  const state = (over: Partial<PlatformState>): PlatformState => ({ status: "pending", attempts: 0, ...over });
  // Before the slot above, so these read as they would the day they were booked.
  const early = new Date("2026-07-15T12:00:00.000Z");
  const late = new Date("2026-07-16T12:00:00.000Z");

  it("confirms the upload day for a scheduled YouTube post", () => {
    const summary = summarizePlatformState(
      "youtube",
      state({ status: "scheduled", postId: "vid123", uploadedAt: "2026-07-14T10:00:05.000Z" }),
      item,
      zone,
      early
    );
    expect(summary.uploaded).toMatch(/^Uploaded /);
    expect(summary.note).toMatch(/^Goes live /);
  });

  it("falls back to createdAt when an uploaded post predates the uploadedAt stamp", () => {
    const summary = summarizePlatformState("youtube", state({ status: "scheduled", postId: "vid123" }), item, zone);
    expect(summary.uploaded).toMatch(/^Uploaded /);
  });

  it("shows no upload confirmation before anything is sent", () => {
    expect(summarizePlatformState("youtube", state({ status: "pending" }), item, zone).uploaded).toBeNull();
    expect(summarizePlatformState("tiktok", state({ status: "manual" }), item, zone).uploaded).toBeNull();
  });

  it("reads a manual reminder as waiting for a connection before its slot, and as missed after it", () => {
    const before = summarizePlatformState("youtube", state({ status: "manual" }), item, zone, new Date("2026-07-14T12:00:00.000Z"));
    expect(before.note).toMatch(/^Waiting for YouTube - connect to post automatically, or post by hand at /);
    expect(before.note).not.toMatch(/manual/i);
    const after = summarizePlatformState("youtube", state({ status: "manual" }), item, zone, new Date("2026-07-16T12:00:00.000Z"));
    expect(after.note).toMatch(/^Post by hand - the .* slot passed without a connection$/);
    expect(after.note).not.toMatch(/manual/i);
  });

  it("surfaces the failure in words instead of an upload day, keeping the platform's own text for the tooltip", () => {
    const summary = summarizePlatformState("youtube", state({ status: "failed", error: "quota exceeded" }), item, zone);
    expect(summary.uploaded).toBeNull();
    expect(summary.note).toBe("Upload failed - YouTube couldn't take it just then — worth another go.");
    expect(summary.detail).toBe("quota exceeded");
  });

  it("does not offer a retry for a duplicate-title refusal", () => {
    const summary = summarizePlatformState(
      "youtube",
      state({ status: "failed", error: '"My clip" is already on the channel (https://x) — this upload was stopped rather than posting it a second time.' }),
      item,
      zone
    );
    expect(summary.note).toContain("Retitle");
  });

  it("uses the board's wording for a post that has not gone up: only YouTube is 'Uploading'", () => {
    expect(summarizePlatformState("youtube", state({ status: "pending" }), item, zone, early).note).toMatch(/^Uploading · slot /);
    const instagram = summarizePlatformState("instagram", state({ status: "pending" }), item, zone, early);
    expect(instagram.note).toMatch(/^Posts at slot · slot /);
    expect(instagram.detail).toContain("no scheduling API");
  });

  it("calls a pending post whose slot passed Overdue, and points at Automations", () => {
    const instagram = summarizePlatformState("instagram", state({ status: "pending" }), item, zone, late);
    expect(instagram.note).toMatch(/^Overdue · slot /);
    expect(instagram.detail).toBe("Its slot passed and the publisher hasn't sent it yet - check Automations");
  });

  it("says a scheduled YouTube post past its slot should be live, not that it is overdue", () => {
    const youtube = summarizePlatformState("youtube", state({ status: "scheduled", postId: "vid123" }), item, zone, late);
    expect(youtube.note).toMatch(/^Should be live - check YouTube \(slot /);
    expect(youtube.note).not.toMatch(/Overdue/);
  });

  it("does not call a TikTok inbox draft 'live' or 'nothing else needed'", () => {
    const summary = summarizePlatformState("tiktok", state({ status: "scheduled", postId: "p1" }), item, zone);
    expect(summary.note).toBe("In your TikTok inbox - Finish it in the TikTok app");
    const direct = summarizePlatformState("tiktok", state({ status: "scheduled" }), { ...item, tiktok: { delivery: "direct" } }, zone);
    expect(direct.note).toMatch(/^Goes live /);
  });

  it("reports a published long-form video as private, not live", () => {
    const summary = summarizePlatformState(
      "youtube",
      state({ status: "published", postId: "vid123", uploadedAt: "2026-07-14T10:00:05.000Z", publishedAt: "2026-07-15T19:30:00.000Z" }),
      { ...item, format: "long" },
      zone
    );
    expect(summary.note).toBe("Private on YouTube - make it public after you review it");
  });

  it("reports a published post as live", () => {
    const summary = summarizePlatformState(
      "youtube",
      state({ status: "published", postId: "vid123", uploadedAt: "2026-07-14T10:00:05.000Z", publishedAt: "2026-07-15T19:30:00.000Z" }),
      item,
      zone
    );
    expect(summary.uploaded).toMatch(/^Uploaded /);
    expect(summary.note).toMatch(/^Live since /);
  });

  it("states every time on the publish zone's wall clock, whatever zone the browser is in", () => {
    // 02:30 UTC on Jul 16 is still the evening of Jul 15 in Toronto.
    const late = { publishAt: "2026-07-16T02:30:00.000Z", createdAt: "2026-07-16T01:00:00.000Z" };
    const scheduled = state({ status: "scheduled", postId: "v1", uploadedAt: "2026-07-16T01:00:05.000Z" });
    const toronto = summarizePlatformState("youtube", scheduled, late, "America/Toronto");
    expect(toronto.note).toContain("Wed, Jul 15");
    expect(toronto.note).toContain("10:30");
    expect(toronto.uploaded).toBe("Uploaded Wed, Jul 15");
    const utc = summarizePlatformState("youtube", scheduled, late, "UTC");
    expect(utc.note).toContain("Thu, Jul 16");
    expect(utc.note).toContain("2:30");
    expect(utc.uploaded).toBe("Uploaded Thu, Jul 16");
  });
});
