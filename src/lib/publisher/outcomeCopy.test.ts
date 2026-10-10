import { describe, expect, it } from "vitest";
import { describeRunOutcome, formatGoLive } from "@/lib/publisher/outcomeCopy";

// 3:00 PM on 2026-07-14 in Toronto (UTC-4).
const SLOT = "2026-07-14T19:00:00.000Z";
const NOW = new Date("2026-07-13T12:00:00.000Z");
const context = { publishAt: SLOT, timeZone: "America/Toronto", now: NOW };

describe("what a run outcome says in a toast", () => {
  it("says a YouTube post that was only held for its slot is not live yet, and when it will be", () => {
    const line = describeRunOutcome(
      { platform: "youtube", outcome: "scheduled", detail: "already uploaded and waiting for its slot on YouTube" },
      context
    );
    expect(line.tone).toBe("info");
    expect(line.text).toBe("YouTube: already uploaded, goes live at Tue, Jul 14, 3:00 PM");
  });

  it("says 'now public' when an explicit Publish now flipped the video", () => {
    const line = describeRunOutcome(
      { platform: "youtube", outcome: "published", detail: "set public now at your request, ahead of its slot" },
      context
    );
    expect(line).toEqual({ tone: "success", text: "YouTube: now public" });
  });

  it("does not claim a long-form video is public", () => {
    const line = describeRunOutcome(
      { platform: "youtube", outcome: "published", detail: "kept private for review - cleared the go-live time" },
      context
    );
    expect(line.text).toContain("private");
    expect(line.text).not.toContain("now public");
  });

  it("tells a TikTok inbox draft apart from a post", () => {
    const line = describeRunOutcome({ platform: "tiktok", outcome: "scheduled", detail: "Sent to your TikTok inbox" }, context);
    expect(line.text).toContain("TikTok inbox");
    expect(line.text).toContain("finish the post");
  });

  it("turns a failure into advice, not the provider's payload", () => {
    const line = describeRunOutcome(
      { platform: "instagram", outcome: "failed", detail: '{"error":{"code":190,"message":"Invalid OAuth access token"}}' },
      context
    );
    expect(line.tone).toBe("error");
    expect(line.text).toBe("Instagram rejected this upload.");
    expect(line.raw).toContain("Invalid OAuth");
    expect(line.text).not.toContain("{");
  });

  it("warns, rather than succeeding, when the post will be retried or is waiting", () => {
    expect(describeRunOutcome({ platform: "facebook", outcome: "retrying", detail: "x" }, context).tone).toBe("warning");
    const deferred = describeRunOutcome({ platform: "youtube", outcome: "deferred", detail: "uploads used" }, context);
    expect(deferred.tone).toBe("warning");
    expect(deferred.text).toContain("upload limit");
  });

  it("formats a same-day time without the date", () => {
    expect(formatGoLive(SLOT, "America/Toronto", new Date("2026-07-14T12:00:00.000Z"))).toBe("3:00 PM");
  });
});
