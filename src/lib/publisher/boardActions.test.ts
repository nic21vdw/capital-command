import { describe, expect, it } from "vitest";
import { publishNowTargets, removalImpact } from "@/lib/publisher/boardActions";
import type { PlatformState } from "@/lib/publisher/types";

const leg = (over: Partial<PlatformState>): PlatformState => ({ status: "pending", attempts: 0, ...over });

describe("what Remove touches", () => {
  it("lists every platform on the post, in a fixed order", () => {
    const impact = removalImpact({ platforms: { facebook: leg({}), youtube: leg({}), instagram: leg({}) } });
    expect(impact.platforms).toEqual(["youtube", "instagram", "facebook"]);
    expect(impact.youtube).toBeNull();
    expect(impact.facebook).toBeNull();
  });

  it("flags a YouTube video the channel already holds, so Remove can keep it private", () => {
    expect(removalImpact({ platforms: { youtube: leg({ status: "scheduled", postId: "vid1" }) } }).youtube).toEqual({
      platform: "youtube",
      postId: "vid1"
    });
    expect(removalImpact({ platforms: { youtube: leg({ status: "uploaded", postId: "vid1" }) } }).youtube).not.toBeNull();
  });

  it("does not flag a YouTube leg that never uploaded, or one that is already live", () => {
    expect(removalImpact({ platforms: { youtube: leg({ status: "pending" }) } }).youtube).toBeNull();
    expect(removalImpact({ platforms: { youtube: leg({ status: "published", postId: "vid1" }) } }).youtube).toBeNull();
  });

  it("flags a Facebook post it holds, which cannot be cancelled from here", () => {
    expect(removalImpact({ platforms: { facebook: leg({ status: "scheduled", postId: "fb1" }) } }).facebook).toEqual({
      platform: "facebook",
      postId: "fb1"
    });
    expect(removalImpact({ platforms: { facebook: leg({ status: "pending" }) } }).facebook).toBeNull();
  });
});

describe("what Publish now touches", () => {
  it("is every unfinished platform of the post, not just the tab it was pressed on", () => {
    expect(
      publishNowTargets({
        platforms: {
          youtube: leg({ status: "scheduled", postId: "v" }),
          instagram: leg({ status: "pending" }),
          tiktok: leg({ status: "uploaded" }),
          facebook: leg({ status: "pending" })
        }
      })
    ).toEqual(["youtube", "instagram", "tiktok", "facebook"]);
  });

  it("does not offer a long-form YouTube video, which stays private for review whatever is pressed", () => {
    expect(
      publishNowTargets({ format: "long", platforms: { youtube: leg({ status: "scheduled", postId: "v" }) } })
    ).toEqual([]);
  });

  it("leaves finished, failed and manual legs alone (Retry's job), and a TikTok draft already in the inbox", () => {
    expect(
      publishNowTargets({
        platforms: {
          youtube: leg({ status: "published" }),
          instagram: leg({ status: "failed" }),
          tiktok: leg({ status: "scheduled", postId: "t" }),
          facebook: leg({ status: "manual" })
        }
      })
    ).toEqual([]);
  });
});
