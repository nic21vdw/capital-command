import { describe, expect, it } from "vitest";
import { describeFailure, isConnectionFailure } from "@/lib/publisher/failure";
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
    expect(advice.headline).toContain("No TikTok account was connected");
    expect(advice.raw).toBe("TikTok isn't connected yet.");
  });

  it("offers a retry when the platform simply wouldn't take it", () => {
    const rejected = describeFailure({ status: "failed", attempts: 1, error: '{"error":{"code":400,"reason":"badRequest"}}' }, "youtube");
    expect(rejected.action).toBe("retry");
    expect(rejected.headline).toBe("YouTube rejected this upload.");

    const quota = describeFailure({ status: "failed", attempts: 1, error: "quotaExceeded: daily limit" }, "youtube");
    expect(quota.action).toBe("retry");
    expect(quota.headline).toContain("worth another go");
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
