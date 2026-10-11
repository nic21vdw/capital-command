import { describe, expect, it } from "vitest";
import {
  blockedLegControls,
  connectLinkLabel,
  hasFreshClaim,
  legAccountId,
  publishNowSkipped,
  publishNowTargets,
  publishedRemovalNote,
  removalImpact
} from "@/lib/publisher/boardActions";
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

describe("Publish now and connections", () => {
  const post = {
    platforms: {
      youtube: leg({ status: "pending" }),
      instagram: leg({ status: "pending" }),
      facebook: leg({ status: "pending" })
    }
  };

  it("only sends the legs whose account is connected, and names the rest as skipped", () => {
    const connected = (platform: string) => platform !== "youtube";
    expect(publishNowTargets(post, connected)).toEqual(["instagram", "facebook"]);
    expect(publishNowSkipped(post, connected)).toEqual(["youtube"]);
  });

  it("offers nothing when no pending leg is connected", () => {
    expect(publishNowTargets(post, () => false)).toEqual([]);
    expect(publishNowSkipped(post, () => false)).toEqual(["youtube", "instagram", "facebook"]);
  });

  it("is unchanged when everything is connected", () => {
    expect(publishNowTargets(post, () => true)).toEqual(publishNowTargets(post));
    expect(publishNowSkipped(post, () => true)).toEqual([]);
  });

  it("reads the account a post is on, the platform's primary for an older one", () => {
    expect(legAccountId({ accountId: "tiktok-2" }, "tiktok")).toBe("tiktok-2");
    expect(legAccountId({}, "tiktok")).toBe("tiktok-primary");
  });
});

describe("which controls a blocked leg offers", () => {
  const rejected = { action: "retry", kind: "retryable" } as const;
  const lapsed = { action: "reconnect", kind: "connection-lapsed" } as const;
  const neverSetUp = { action: "reconnect", kind: "not-connected" } as const;
  const duplicate = { action: "none", kind: "duplicate-title" } as const;
  const gone = { action: "none", kind: "missing-media" } as const;

  it("lets connection state win: no Retry on an unconnected account, whatever the error", () => {
    expect(blockedLegControls(rejected, { connected: false, retitled: false })).toEqual({
      retry: false,
      connect: "Connect",
      rename: false,
      needsConnection: true
    });
    expect(blockedLegControls(lapsed, { connected: false, retitled: false })).toMatchObject({ retry: false, connect: "Reconnect" });
    expect(blockedLegControls(neverSetUp, { connected: false, retitled: false })).toMatchObject({ retry: false, connect: "Connect" });
  });

  it("offers Retry again once the account is connected", () => {
    expect(blockedLegControls(rejected, { connected: true, retitled: false })).toEqual({
      retry: true,
      connect: null,
      rename: false,
      needsConnection: false
    });
    expect(blockedLegControls(neverSetUp, { connected: true, retitled: false })).toMatchObject({ retry: true, connect: null });
  });

  it("keeps Reconnect beside Retry for stale credentials on a connected account", () => {
    expect(blockedLegControls(lapsed, { connected: true, retitled: false })).toMatchObject({ retry: true, connect: "Reconnect" });
  });

  it("offers Rename whatever the connection, but Retry only after connecting and renaming", () => {
    expect(blockedLegControls(duplicate, { connected: true, retitled: false })).toMatchObject({ rename: true, retry: false });
    expect(blockedLegControls(duplicate, { connected: true, retitled: true })).toMatchObject({ rename: false, retry: true });
    expect(blockedLegControls(duplicate, { connected: false, retitled: false })).toMatchObject({
      rename: true,
      retry: false,
      connect: "Connect"
    });
    expect(blockedLegControls(duplicate, { connected: false, retitled: true })).toMatchObject({ rename: false, retry: false, connect: "Connect" });
  });

  it("offers nothing for a file that is gone, connected or not", () => {
    for (const connected of [true, false]) {
      expect(blockedLegControls(gone, { connected, retitled: false })).toEqual({
        retry: false,
        connect: null,
        rename: false,
        needsConnection: false
      });
    }
  });
});

describe("connectLinkLabel", () => {
  it("says what the connection is for beside Rename on a duplicate-title card", () => {
    const controls = { connect: "Connect" as const, needsConnection: true };
    expect(connectLinkLabel(controls, { kind: "duplicate-title" }, "YouTube")).toBe("Connect YouTube to retry");
  });

  it("stays plain where the connection is the whole fix", () => {
    const controls = { connect: "Reconnect" as const, needsConnection: true };
    expect(connectLinkLabel(controls, { kind: "connection-lapsed" }, "TikTok")).toBe("Reconnect TikTok");
    expect(connectLinkLabel({ connect: "Connect", needsConnection: true }, null, "YouTube")).toBe("Connect YouTube");
  });

  it("offers nothing when no connection is missing", () => {
    expect(connectLinkLabel({ connect: null, needsConnection: false }, { kind: "retryable" }, "YouTube")).toBeNull();
  });
});
