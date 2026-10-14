import { describe, expect, it } from "vitest";
import { YOUTUBE_UNITS_PER_UPLOAD_SAFE, remainingYoutubeUploads, youtubeQuota } from "@/lib/publisher/quota";
import { testConfig, testItem } from "@/lib/publisher/test-helpers";
import type { QueueItem } from "@/lib/publisher/types";

// 18:00Z is 11:00 Pacific — the same quota day as 10:00Z (03:00 Pacific).
const NOW = new Date("2026-07-08T18:00:00Z");

function ytItem(id: string, state: Partial<NonNullable<QueueItem["platforms"]["youtube"]>>): QueueItem {
  const item = testItem({ id, platformIds: ["youtube"] });
  Object.assign(item.platforms.youtube!, state);
  return item;
}

describe("youtubeQuota", () => {
  it("counts today's uploads and projects pending ones", () => {
    const items = [
      ytItem("a", { status: "scheduled", uploadedAt: "2026-07-08T10:00:00Z" }),
      ytItem("b", { status: "published", uploadedAt: "2026-07-08T15:00:00Z" }),
      ytItem("c", { status: "pending" }),
      // Yesterday's upload does not count against today.
      ytItem("d", { status: "published", uploadedAt: "2026-07-07T10:00:00Z" }),
      // Terminal without an upload (manual/failed) costs nothing.
      ytItem("e", { status: "failed" })
    ];
    const quota = youtubeQuota(items, NOW, testConfig());
    expect(quota.uploadsUsed).toBe(2);
    expect(quota.uploadsPending).toBe(1);
    expect(quota.projectedUploads).toBe(3);
    expect(quota.usedUnits).toBe(3200);
    expect(quota.overBudget).toBe(false);
  });

  it("uses the Pacific reset day, not the UTC one", () => {
    // 05:00Z on Jul 8 is still 22:00 Jul 7 Pacific — a different quota day
    // than NOW (11:00 Jul 8 Pacific).
    const items = [ytItem("a", { status: "published", uploadedAt: "2026-07-08T05:00:00Z" })];
    expect(youtubeQuota(items, NOW, testConfig()).uploadsUsed).toBe(0);
  });

  it("flags projections over the budget", () => {
    const items = Array.from({ length: 7 }, (_, i) => ytItem(`p${i}`, { status: "pending" }));
    const quota = youtubeQuota(items, NOW, testConfig());
    expect(quota.projectedUploads).toBe(7);
    expect(quota.budgetUploads).toBe(6);
    expect(quota.overBudget).toBe(true);
  });

  it("ignores items without a youtube platform", () => {
    const quota = youtubeQuota([testItem({ platformIds: ["tiktok"] })], NOW, testConfig());
    expect(quota.projectedUploads).toBe(0);
  });
});

describe("sharing the day's quota with Listening", () => {
  const used = [
    ytItem("a", { status: "scheduled", uploadedAt: "2026-07-08T10:00:00Z" }),
    ytItem("b", { status: "published", uploadedAt: "2026-07-08T15:00:00Z" })
  ];

  it("sizes an upload at about 1,700 units", () => {
    expect(YOUTUBE_UNITS_PER_UPLOAD_SAFE).toBe(1700);
  });

  it("changes nothing when Listening has spent nothing", () => {
    expect(remainingYoutubeUploads(used, NOW, testConfig())).toBe(4);
    expect(remainingYoutubeUploads(used, NOW, testConfig(), 0)).toBe(4);
  });

  it("takes Listening's units out of the upload budget, rounding up to whole uploads", () => {
    expect(remainingYoutubeUploads(used, NOW, testConfig(), 100)).toBe(3);
    expect(remainingYoutubeUploads(used, NOW, testConfig(), 1700)).toBe(3);
    expect(remainingYoutubeUploads(used, NOW, testConfig(), 1701)).toBe(2);
    expect(remainingYoutubeUploads(used, NOW, testConfig(), 50_000)).toBe(0);
  });

  it("shows the reduced budget and the spent units on the Uploading Center meter", () => {
    const quota = youtubeQuota(used, NOW, testConfig(), 400);
    expect(quota.budgetUploads).toBe(5);
    expect(quota.listeningUnits).toBe(400);
    expect(quota.usedUnits).toBe(2 * 1600 + 400);
    expect(youtubeQuota(used, NOW, testConfig()).listeningUnits).toBe(0);
  });
});
