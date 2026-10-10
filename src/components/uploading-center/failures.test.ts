import { describe, expect, it } from "vitest";
import {
  collectFailedLegs,
  connectionFailurePlatforms,
  failureCounts,
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
