import { describe, expect, it } from "vitest";
import { describeFailure, describeWaiting, duplicateTitleCleared, isConnectionFailure } from "@/lib/publisher/failure";
import { channelDuplicateMessage } from "@/lib/publisher/duplicateGuard";
import { YOUTUBE_RECONNECT_FOR_SCOPE, YOUTUBE_RECONNECT_REQUIRED } from "@/lib/publisher/googleAuth";

describe("failures a fresh connection fixes", () => {
  it("counts a dead grant, a missing scope and a platform that was never connected", () => {
    expect(isConnectionFailure({ status: "manual", attempts: 0 })).toBe(true);
    expect(isConnectionFailure({ status: "failed", attempts: 3, error: YOUTUBE_RECONNECT_REQUIRED })).toBe(true);
    expect(isConnectionFailure({ status: "failed", attempts: 3, error: YOUTUBE_RECONNECT_FOR_SCOPE })).toBe(true);
    expect(isConnectionFailure({ status: "failed", attempts: 1, error: "HTTP 401 invalid_grant" })).toBe(true);
    expect(
      isConnectionFailure({ status: "failed", attempts: 1, error: "tiktok credentials are not configured for this account." })
    ).toBe(true);
  });

  it("does not count a post the platform itself rejected", () => {
    expect(isConnectionFailure({ status: "failed", attempts: 1, error: "Video is too long for a Short." })).toBe(false);
    expect(isConnectionFailure({ status: "failed", attempts: 1, error: "Clip file data/x.mp4 is not on this machine" })).toBe(
      false
    );
    expect(isConnectionFailure({ status: "failed", attempts: 1 })).toBe(false);
  });
});

describe("what a blocked post says on the board", () => {
  it("asks for a reconnect when the connection is what broke", () => {
    const advice = describeFailure({ status: "failed", attempts: 3, error: YOUTUBE_RECONNECT_REQUIRED }, "youtube");

    expect(advice.action).toBe("reconnect");
    expect(advice.headline).toContain("YouTube connection expired");
    expect(advice.raw).toBe(YOUTUBE_RECONNECT_REQUIRED);
  });

  it("explains a manual post as a missing connection, not an error", () => {
    const advice = describeFailure({ status: "manual", attempts: 0, note: "TikTok isn't connected yet." }, "tiktok");

    expect(advice.action).toBe("reconnect");
    expect(advice.headline).toContain("Post by hand - no TikTok account was connected");
    expect(advice.raw).toBe("TikTok isn't connected yet.");
  });

  it("does not say a manual post never went out before its slot has come", () => {
    const now = new Date("2026-10-10T12:00:00.000Z");
    const before = describeFailure({ status: "manual", attempts: 0 }, "tiktok", {
      publishAt: "2026-10-12T14:00:00.000Z",
      when: "Mon, Oct 12, 10:00 AM",
      now
    });
    expect(before.headline).toBe(
      "Waiting for TikTok - connect to post automatically, or post by hand at Mon, Oct 12, 10:00 AM."
    );
    expect(before.headline).not.toMatch(/never went out/);
    expect(before.action).toBe("reconnect");

    const after = describeFailure({ status: "manual", attempts: 0 }, "tiktok", {
      publishAt: "2026-10-09T14:00:00.000Z",
      now
    });
    expect(after.headline).toContain("Post by hand - no TikTok account was connected by the slot, so this never went out.");
  });

  it("offers a retry when the platform simply wouldn't take it", () => {
    const rejected = describeFailure({ status: "failed", attempts: 1, error: '{"error":{"code":400,"reason":"badRequest"}}' }, "youtube");
    expect(rejected.action).toBe("retry");
    expect(rejected.headline).toBe("YouTube rejected this upload.");

    const quota = describeFailure({ status: "failed", attempts: 1, error: "quotaExceeded: daily limit" }, "youtube");
    expect(quota.action).toBe("retry");
    expect(quota.headline).toContain("worth another go");
  });

  it("says so when the platform took the upload and never fetched the video", () => {
    const advice = describeFailure(
      {
        status: "failed",
        attempts: 3,
        error: 'Facebook never fetched the video — this upload has been stuck at "uploading" for 8h.'
      },
      "facebook"
    );

    expect(advice.action).toBe("retry");
    expect(advice.headline).toContain("never fetched the video");
  });

  it("offers nothing when the video file itself is gone", () => {
    const advice = describeFailure(
      { status: "failed", attempts: 1, error: "Clip file data/clips/a.mp4 is not on this machine and no hosted copy exists" },
      "instagram"
    );

    expect(advice.action).toBe("none");
    expect(advice.headline).toContain("isn't on this machine");
  });

  it("keeps the provider's own words available rather than as the headline", () => {
    const raw = `{"error":{"errors":[{"domain":"youtube.video","reason":"failedPrecondition"}],"code":400}}`;
    const advice = describeFailure({ status: "failed", attempts: 1, error: raw }, "youtube");

    expect(advice.headline).not.toContain("{");
    expect(advice.raw).toBe(raw);
  });
});

describe("advice that has to be true", () => {
  it("tells a duplicate-title refusal to retitle instead of offering a retry that fails again", () => {
    const error = channelDuplicateMessage({ title: "My clip", url: "https://youtube.com/watch?v=abc" });
    const advice = describeFailure({ status: "failed", attempts: 1, error }, "youtube");

    expect(advice.action).toBe("none");
    expect(advice.headline).toContain("Retitle");
    expect(advice.headline).not.toContain("rejected");
    expect(advice.raw).toBe(error);
  });

  it("calls a platform that was never set up a setup problem, not an expired or revoked grant", () => {
    const facebook = describeFailure(
      { status: "failed", attempts: 1, error: "Facebook is not configured. Set FB_PAGE_ID and FB_PAGE_ACCESS_TOKEN." },
      "facebook"
    );
    expect(facebook.headline).toContain("isn't set up");
    expect(facebook.headline).not.toMatch(/expired|revoked/);
    expect(facebook.viaSettings).toBe(true);
    expect(facebook.action).toBe("reconnect");

    const tiktok = describeFailure(
      { status: "failed", attempts: 1, error: "tiktok credentials are not configured for this account." },
      "tiktok"
    );
    expect(tiktok.headline).toContain("isn't set up");
  });

  it("only promises an automatic re-send for YouTube, the one platform a reconnect re-queues", () => {
    const youtube = describeFailure({ status: "failed", attempts: 3, error: YOUTUBE_RECONNECT_REQUIRED }, "youtube");
    expect(youtube.headline).toContain("goes out on its own");
    expect(youtube.viaSettings).toBeUndefined();

    for (const platform of ["tiktok", "instagram", "facebook"] as const) {
      const advice = describeFailure({ status: "failed", attempts: 3, error: "401 unauthorized" }, platform);
      expect(advice.headline).not.toContain("goes out on its own");
      expect(advice.headline).toContain("Settings");
      expect(advice.headline).toContain("Retry");
      expect(advice.viaSettings).toBe(true);
    }
  });

  it("says the same for a manual post: only YouTube sends itself once connected", () => {
    expect(describeFailure({ status: "manual", attempts: 0 }, "youtube").headline).toContain("goes out on its own");
    expect(describeFailure({ status: "manual", attempts: 0 }, "instagram").headline).toContain("press Retry");
  });

  it("still counts an unconfigured platform as something a connection fixes (the re-arm scope)", () => {
    expect(isConnectionFailure({ status: "failed", attempts: 1, error: "Facebook is not configured." })).toBe(true);
  });
});

describe("a leg that is waiting rather than failed", () => {
  it("is silent for a healthy pending leg", () => {
    expect(describeWaiting({ status: "pending", attempts: 0 }, "youtube")).toBeNull();
  });

  it("is silent for a failed or manual leg, which have their own advice", () => {
    expect(describeWaiting({ status: "failed", attempts: 3, error: "x" }, "youtube")).toBeNull();
    expect(describeWaiting({ status: "manual", attempts: 0 }, "youtube")).toBeNull();
  });

  it("explains a backoff in a clause that follows 'Retrying at 3:00 PM - '", () => {
    const waiting = describeWaiting(
      { status: "pending", attempts: 1, error: "YouTube video upload network error", nextAttemptAt: "2026-07-14T20:00:00.000Z" },
      "youtube"
    );
    expect(waiting?.headline).toBe("YouTube couldn't take it just then");
    expect(waiting?.raw).toBe("YouTube video upload network error");
  });

  it("names the upload limit when that is what is holding it", () => {
    const waiting = describeWaiting(
      { status: "pending", attempts: 0, error: "quotaExceeded: daily limit", nextAttemptAt: "2026-07-14T20:00:00.000Z" },
      "youtube"
    );
    expect(waiting?.headline).toContain("upload limit");
  });

  it("shows a booked later attempt even with no error text", () => {
    expect(describeWaiting({ status: "pending", attempts: 0, nextAttemptAt: "2026-07-14T20:00:00.000Z" }, "tiktok")).not.toBeNull();
  });
});

describe("which first step a failure kind asks for", () => {
  const failed = (error?: string) => ({ status: "failed" as const, attempts: 3, error });

  it("tells a retitle from a reconnect from a plain retry", () => {
    const duplicate = describeFailure(failed(channelDuplicateMessage({ title: "Day 44", url: "https://youtu.be/x" })), "youtube");
    expect(duplicate).toMatchObject({ kind: "duplicate-title", action: "none" });

    expect(describeFailure(failed(YOUTUBE_RECONNECT_REQUIRED), "youtube")).toMatchObject({
      kind: "connection-lapsed",
      action: "reconnect"
    });
    expect(describeFailure({ status: "manual", attempts: 0 }, "tiktok")).toMatchObject({
      kind: "not-connected",
      action: "reconnect"
    });
    expect(describeFailure(failed("tiktok credentials are not configured for this account."), "tiktok").kind).toBe(
      "not-connected"
    );
    expect(describeFailure(failed("Clip file data/x.mp4 is not on this machine"), "youtube").kind).toBe("missing-media");
    expect(describeFailure(failed("Video is too long for a Short."), "instagram")).toMatchObject({
      kind: "retryable",
      action: "retry"
    });
  });
});

describe("duplicateTitleCleared", () => {
  const error = channelDuplicateMessage({ title: "What I learned building in public", url: "https://youtu.be/x" });

  it("is false while the post still carries the refused title, whatever its case", () => {
    expect(duplicateTitleCleared(error, "What I learned building in public")).toBe(false);
    expect(duplicateTitleCleared(error, "  what i learned BUILDING in public ")).toBe(false);
  });

  it("is true once the post has a different title", () => {
    expect(duplicateTitleCleared(error, "What I learned building in public (part 2)")).toBe(true);
  });

  it("proves nothing from a message that quotes no title", () => {
    expect(duplicateTitleCleared("already on the channel", "Anything")).toBe(false);
    expect(duplicateTitleCleared(undefined, "Anything")).toBe(false);
  });
});

describe("a manual reminder once the account is connected", () => {
  const manual = { status: "manual" as const, attempts: 0 };
  const context = { publishAt: "2026-10-13T14:00:00.000Z", when: "Tue, Oct 13, 2:00 PM", now: new Date("2026-10-11T00:00:00.000Z") };

  it("still says it is not connected while it is not", () => {
    expect(describeFailure(manual, "tiktok", { ...context, connected: false })).toMatchObject({ kind: "not-connected", action: "reconnect" });
    expect(describeFailure(manual, "tiktok", context).kind).toBe("not-connected");
  });

  it("stops saying 'Not connected' and offers a retry once it is", () => {
    const advice = describeFailure(manual, "tiktok", { ...context, connected: true });
    expect(advice).toMatchObject({ action: "retry", kind: "retryable" });
    expect(advice.headline).not.toMatch(/^Waiting for/);
    expect(advice.headline).toMatch(/connected now/);
    expect(advice.headline).toContain("Tue, Oct 13, 2:00 PM");
    const late = describeFailure(manual, "tiktok", { ...context, now: new Date("2026-10-14T00:00:00.000Z"), connected: true });
    expect(late.headline).toMatch(/Retry now/);
  });
});
