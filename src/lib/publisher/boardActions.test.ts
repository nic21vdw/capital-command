import { describe, expect, it } from "vitest";
import { hasFreshClaim, publishNowTargets, publishedRemovalNote, removalImpact } from "@/lib/publisher/boardActions";
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

describe("Remove on a post that is already live", () => {
  const names = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook" };

  it("lists the platforms that are live, and says a fully published post has nothing left to remove", () => {
    const impact = removalImpact({
      platforms: { youtube: leg({ status: "published", postId: "v" }), instagram: leg({ status: "published" }) }
    });
    expect(impact.published).toEqual(["youtube", "instagram"]);
    expect(impact.fullyPublished).toBe(true);
  });

  it("is only partly published while any leg is still waiting", () => {
    const impact = removalImpact({
      platforms: { youtube: leg({ status: "published", postId: "v" }), tiktok: leg({ status: "pending" }) }
    });
    expect(impact.published).toEqual(["youtube"]);
    expect(impact.fullyPublished).toBe(false);
  });

  it("is not published at all for a post that has not gone up", () => {
    const impact = removalImpact({ platforms: { youtube: leg({}) } });
    expect(impact.published).toEqual([]);
    expect(impact.fullyPublished).toBe(false);
    expect(removalImpact({ platforms: {} }).fullyPublished).toBe(false);
  });

  it("words the note so Remove cannot be read as taking the post down", () => {
    expect(publishedRemovalNote(["youtube"], names)).toBe(
      "Already live on YouTube. Removing only clears it from this schedule; the posts stay up."
    );
    expect(publishedRemovalNote(["youtube", "instagram", "facebook"], names)).toBe(
      "Already live on YouTube, Instagram and Facebook. Removing only clears it from this schedule; the posts stay up."
    );
  });
});

describe("Remove while an upload may be in flight", () => {
  const NOW = new Date("2026-10-10T12:00:00.000Z");
  const claimed = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

  it("sees a fresh claim on any leg, and lets an old one go", () => {
    const item = (minutesAgo: number) => ({ platforms: { instagram: leg({ claimedAt: claimed(minutesAgo) }) } });
    expect(removalImpact(item(5), { now: NOW }).uploading).toBe(true);
    expect(removalImpact(item(14), { now: NOW }).uploading).toBe(true);
    expect(removalImpact(item(15), { now: NOW }).uploading).toBe(false);
    expect(removalImpact(item(60), { now: NOW }).uploading).toBe(false);
    expect(removalImpact({ platforms: { instagram: leg({}) } }, { now: NOW }).uploading).toBe(false);
  });

  it("uses the claim timeout it is given", () => {
    const item = { platforms: { tiktok: leg({ claimedAt: claimed(20) }) } };
    expect(hasFreshClaim(item, NOW, 30)).toBe(true);
    expect(hasFreshClaim(item, NOW, 10)).toBe(false);
  });

  it("flags a YouTube upload session with no video id as a video that may exist", () => {
    const youtube = (over: Partial<PlatformState>) => ({ platforms: { youtube: leg(over) } });
    expect(removalImpact(youtube({ containerId: "https://upload/session" })).youtubeMayExist).toBe(true);
    expect(removalImpact(youtube({ status: "failed", containerId: "https://upload/session" })).youtubeMayExist).toBe(true);
    expect(removalImpact(youtube({ containerId: "s", postId: "vid1", status: "scheduled" })).youtubeMayExist).toBe(false);
    expect(removalImpact(youtube({})).youtubeMayExist).toBe(false);
    // Another platform's container is not a YouTube upload.
    expect(removalImpact({ platforms: { instagram: leg({ containerId: "c1" }) } }).youtubeMayExist).toBe(false);
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

  it.each(["pending", "uploaded", "scheduled", "failed", "manual"] as const)(
    "does not offer a long-form YouTube leg in any status (%s)",
    (status) => {
      expect(
        publishNowTargets({
          format: "long",
          platforms: { youtube: leg({ status, postId: "v" }), instagram: leg({ status: "pending" }) }
        })
      ).toEqual(["instagram"]);
      expect(
        publishNowTargets({
          clipPath: "data/longform/outputs/a/edit.mp4",
          platforms: { youtube: leg({ status }) }
        })
      ).toEqual([]);
    }
  );

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
