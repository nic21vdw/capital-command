import { describe, expect, it } from "vitest";
import {
  collectFailedLegs,
  connectionFailurePlatforms,
  describeRearmResults,
  failureCounts,
  planConnectionRetry,
  platformList,
  retryConnectionHelp,
  retryConnectionLabel,
  tabLabelWithFailures
} from "@/components/uploading-center/failures";
import { testItem } from "@/lib/publisher/test-helpers";
import type { PlatformId, PlatformState, QueueItem } from "@/lib/publisher/types";

const failed = (error?: string): PlatformState => ({ status: "failed", attempts: 3, error });
const ok = (): PlatformState => ({ status: "scheduled", attempts: 1 });

function item(id: string, publishAt: string, platforms: Partial<Record<PlatformId, PlatformState>>, accountId?: string) {
  const base = testItem({ id, publishAt, platformIds: [] });
  return { ...base, ...(accountId ? { accountId } : {}), platforms } as QueueItem;
}

describe("collectFailedLegs", () => {
  const items = [
    item("late", "2026-10-12T15:00:00.000Z", { youtube: failed("quota exceeded"), instagram: ok() }),
    item("early", "2026-10-11T15:00:00.000Z", {
      instagram: failed("Instagram connection expired or revoked, reconnect"),
      facebook: { status: "manual", attempts: 0 }
    }),
    item("fine", "2026-10-13T15:00:00.000Z", { youtube: ok() })
  ];

  it("finds failures on every platform, nearest slot first", () => {
    const legs = collectFailedLegs(items);
    expect(legs.map((leg) => `${leg.item.id}:${leg.platform}`)).toEqual(["early:instagram", "late:youtube"]);
  });

  it("does not list a leg that is merely waiting for a connection (manual)", () => {
    expect(collectFailedLegs(items).some((leg) => leg.platform === "facebook")).toBe(false);
  });

  it("marks the failures a reconnect fixes", () => {
    const legs = collectFailedLegs(items);
    expect(legs.find((leg) => leg.platform === "instagram")?.connection).toBe(true);
    expect(legs.find((leg) => leg.platform === "youtube")?.connection).toBe(false);
  });

  it("stops telling you to retitle once the post has been retitled", () => {
    const refused = `"Old title" is already on the channel (https://youtu.be/x) - this upload was stopped rather than posting it a second time.`;
    const [still] = collectFailedLegs([{ ...item("a", "2026-10-11T15:00:00.000Z", { youtube: failed(refused) }), title: "Old title" }]);
    expect(still.headline).toContain("already on your YouTube channel");
    const [renamed] = collectFailedLegs([{ ...item("a", "2026-10-11T15:00:00.000Z", { youtube: failed(refused) }), title: "New title" }]);
    expect(renamed.headline).toBe("Renamed since - ready to retry from its card.");
  });

  it("attributes a legacy item to the platform's primary account", () => {
    const [leg] = collectFailedLegs([item("a", "2026-10-11T15:00:00.000Z", { tiktok: failed("nope") })]);
    expect(leg.accountId).toBe("tiktok-primary");
    const [owned] = collectFailedLegs([item("b", "2026-10-11T15:00:00.000Z", { tiktok: failed("nope") }, "tiktok-2")]);
    expect(owned.accountId).toBe("tiktok-2");
  });
});

describe("the strip's counts", () => {
  const legs = collectFailedLegs([
    item("a", "2026-10-11T15:00:00.000Z", { youtube: failed("quota"), instagram: failed("reconnect please") }),
    item("b", "2026-10-12T15:00:00.000Z", { youtube: failed("quota") })
  ]);

  it("counts per platform tab", () => {
    expect(failureCounts(legs)).toEqual({ youtube: 2, instagram: 1, tiktok: 0, facebook: 0 });
  });

  it("names only the platforms with a connection failure to retry", () => {
    expect(connectionFailurePlatforms(legs)).toEqual(["instagram"]);
  });

  it("puts the count on the tab label only when there is one", () => {
    expect(tabLabelWithFailures("YouTube", 2)).toBe("YouTube (2 failed)");
    expect(tabLabelWithFailures("TikTok", 0)).toBe("TikTok");
  });
});

describe("planConnectionRetry", () => {
  const now = new Date("2026-10-10T16:00:00.000Z");
  const lost = "TikTok connection expired or was revoked, reconnect";
  const legs = collectFailedLegs([
    item("old-tt", "2026-10-09T12:30:00.000Z", { tiktok: failed(lost) }),
    item("new-tt", "2026-10-10T10:00:00.000Z", { tiktok: failed(lost) }),
    item("new-ig", "2026-10-10T12:00:00.000Z", { instagram: failed("Instagram reconnect needed") }),
    item("rejected", "2026-10-10T12:00:00.000Z", { youtube: failed("Video is too long for a Short.") })
  ]);
  const plan = (connected: PlatformId[]) =>
    planConnectionRetry(legs, { now, maxSlotAgeHours: 24, isConnected: (platform) => connected.includes(platform) });

  it("targets nothing while the failing platform is not connected, and says which to connect", () => {
    const result = plan([]);
    expect(result.targets).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.needConnection).toEqual(["instagram", "tiktok"]);
    expect(retryConnectionHelp(result)).toBe("Connect Instagram and TikTok first, then retry.");
  });

  it("targets only the connected platform's recent posts, per account", () => {
    const result = plan(["tiktok"]);
    expect(result.targets).toEqual([{ platform: "tiktok", accountId: "tiktok-primary", count: 1 }]);
    expect(result.count).toBe(1);
    expect(result.tooOld).toBe(1);
    expect(result.needConnection).toEqual(["instagram"]);
    expect(retryConnectionHelp(result)).toContain("Instagram still needs connecting");
  });

  it("leaves a post that is not a connection failure out of every bucket", () => {
    const result = plan(["youtube", "tiktok", "instagram"]);
    expect(result.targets.map((target) => target.platform)).toEqual(["tiktok", "instagram"]);
    expect(result.needConnection).toEqual([]);
  });

  it("explains a connected platform whose only failure is too old", () => {
    const result = planConnectionRetry(legs.filter((leg) => leg.item.id === "old-tt"), {
      now,
      maxSlotAgeHours: 24,
      isConnected: () => true
    });
    expect(result.count).toBe(0);
    expect(retryConnectionHelp(result)).toContain("more than a day past its slot");
  });

  it("writes the label with the count it will act on", () => {
    expect(retryConnectionLabel(0)).toBe("Retry posts that lost their connection");
    expect(retryConnectionLabel(1)).toBe("Retry 1 post that lost its connection");
    expect(retryConnectionLabel(3)).toBe("Retry 3 posts that lost their connection");
    expect(platformList(["youtube", "tiktok", "instagram"])).toBe("YouTube, TikTok and Instagram");
  });
});

describe("describeRearmResults", () => {
  it("is a success only when everything asked for went back", () => {
    const result = describeRearmResults([{ platform: "tiktok", recovered: 2, skippedOld: 0 }]);
    expect(result.tone).toBe("success");
    expect(result.message).toBe("TikTok: 2 posts back in the queue (they go out on the next publisher pass).");
  });

  it("names each platform's outcome and warns about what was left", () => {
    const result = describeRearmResults([
      { platform: "tiktok", recovered: 1, skippedOld: 1 },
      { platform: "instagram", recovered: 0, skippedOld: 0, error: "Network error while retrying." }
    ]);
    expect(result.tone).toBe("warning");
    expect(result.message).toContain("TikTok: 1 post back in the queue");
    expect(result.message).toContain("1 older post left failed - retry from the card");
    expect(result.message).toContain("Instagram: Network error while retrying.");
  });

  it("says nothing was put back when nothing was", () => {
    const result = describeRearmResults([{ platform: "tiktok", recovered: 0, skippedOld: 1 }]);
    expect(result.tone).toBe("warning");
    expect(result.message.startsWith("Nothing was put back. TikTok: 1 older post left failed")).toBe(true);
  });
});
