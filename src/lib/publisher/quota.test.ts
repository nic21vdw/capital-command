import { describe, expect, it } from "vitest";
import { linkedinPostsToday, remainingYoutubeUploads, youtubeQuota } from "@/lib/publisher/quota";
import { testConfig, testItem } from "@/lib/publisher/test-helpers";
import type { QueueItem } from "@/lib/publisher/types";
import type { LedgerSnapshot } from "@/lib/youtube/quotaLedger";

// 18:00Z is 11:00 Pacific — the same quota day as 10:00Z (03:00 Pacific).
const NOW = new Date("2026-07-08T18:00:00Z");

it("counts LinkedIn post acceptance today without charging media uploaded before creation", () => {
  const posted = testItem({ id: "posted", platformIds: ["linkedin"] });
  Object.assign(posted.platforms.linkedin!, { postId: "urn:li:share:1", uploadedAt: "2026-07-07T10:00:00Z", publishedAt: "2026-07-08T10:00:00Z" });
  const media = testItem({ id: "media-only", platformIds: ["linkedin"] });
  Object.assign(media.platforms.linkedin!, { containerId: "urn:li:video:1", uploadedAt: "2026-07-08T09:00:00Z" });
  expect(linkedinPostsToday([posted, media], NOW)).toBe(1);
});

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

function ledgerOf(byPurpose: LedgerSnapshot["byPurpose"], overrides: Partial<LedgerSnapshot> = {}): LedgerSnapshot {
  const spent = Object.values(byPurpose).reduce((sum, value) => sum + (value ?? 0), 0);
  const nonUploadSpent = spent - (byPurpose.upload ?? 0);
  return {
    day: "2026-07-08",
    dailyUnits: 10_000,
    spent,
    byPurpose,
    purposeCaps: { inbox: 200, listening: 100 },
    uploadReserve: 9_600,
    nonUploadCapConfigured: 300,
    nonUploadAllowance: 300,
    nonUploadClamped: false,
    nonUploadSpent,
    nonUploadRemaining: Math.max(0, 300 - nonUploadSpent),
    ...overrides
  };
}

const used = [
  ytItem("a", { status: "scheduled", uploadedAt: "2026-07-08T10:00:00Z" }),
  ytItem("b", { status: "published", uploadedAt: "2026-07-08T15:00:00Z" })
];

describe("remaining uploads come from the ledger", () => {
  it("is the configured budget less today's uploads when the ledger has nothing else to say", () => {
    expect(remainingYoutubeUploads(used, NOW, testConfig())).toBe(4);
    expect(remainingYoutubeUploads(used, NOW, testConfig(), null)).toBe(4);
    expect(remainingYoutubeUploads(used, NOW, testConfig(), ledgerOf({ upload: 3200 }))).toBe(4);
  });

  it("does not take a unit from the upload budget for anything the non-upload allowance holds", () => {
    const everyoneAtTheirCap = ledgerOf({ upload: 3200, inbox: 200, listening: 100 });

    expect(remainingYoutubeUploads(used, NOW, testConfig(), everyoneAtTheirCap)).toBe(4);
    expect(remainingYoutubeUploads([], NOW, testConfig(), ledgerOf({ inbox: 200, listening: 100 }))).toBe(6);
  });

  it("stops at what the ledger says the day has left, so a spent day defers the next upload", () => {
    const thin = ledgerOf({ upload: 8_400 }, { spent: 9_900 });

    expect(remainingYoutubeUploads([], NOW, testConfig(), thin)).toBe(0);
    expect(remainingYoutubeUploads([], NOW, testConfig(), ledgerOf({ upload: 6_400 }, { spent: 6_400 }))).toBe(2);
  });

  it("still counts the queue, so a ledger that lost the morning's uploads cannot hand out the day twice", () => {
    expect(remainingYoutubeUploads(used, NOW, testConfig(), ledgerOf({}))).toBe(4);
  });

  it("ignores a ledger from another day", () => {
    expect(remainingYoutubeUploads(used, NOW, testConfig(), ledgerOf({ upload: 9_900 }, { day: "2026-07-07", spent: 9_900 }))).toBe(4);
  });
});

describe("the quota meter's numbers", () => {
  it("shows the ledger's per-purpose split, in a fixed order, with sub-caps", () => {
    const quota = youtubeQuota(used, NOW, testConfig(), ledgerOf({ listening: 100, upload: 3_200, inbox: 40, analytics: 12, "inbox-reply": 50 }));

    expect(quota.split).toEqual([
      { purpose: "upload", units: 3_200 },
      { purpose: "analytics", units: 12 },
      { purpose: "inbox", units: 40, cap: 200 },
      { purpose: "inbox-reply", units: 50 },
      { purpose: "listening", units: 100, cap: 100 }
    ]);
    expect(quota.usedUnits).toBe(3_402);
    expect(quota.dailyUnits).toBe(10_000);
    expect(quota.nonUploadSpent).toBe(202);
    expect(quota.nonUploadAllowance).toBe(300);
    expect(quota.remainingUploads).toBe(4);
    expect(quota.ledgerReadable).toBe(true);
  });

  it("keeps the budget at the configured uploads a day, with nothing displaced", () => {
    const quota = youtubeQuota(used, NOW, testConfig(), ledgerOf({ upload: 3_200, listening: 100, inbox: 200 }));

    expect(quota.budgetUploads).toBe(6);
    expect(quota.uploadsUsed).toBe(2);
    expect(quota.overBudget).toBe(false);
  });

  it("lists a sub-capped purpose even before it has spent anything, so the cap is visible", () => {
    const quota = youtubeQuota([], NOW, testConfig(), ledgerOf({}));

    expect(quota.split).toEqual([
      { purpose: "upload", units: 0 },
      { purpose: "inbox", units: 0, cap: 200 },
      { purpose: "listening", units: 0, cap: 100 }
    ]);
  });

  it("falls back to the queue's count when the ledger cannot be read, and says so", () => {
    const quota = youtubeQuota(used, NOW, testConfig(), null);

    expect(quota.ledgerReadable).toBe(false);
    expect(quota.usedUnits).toBe(3_200);
    expect(quota.split).toEqual([{ purpose: "upload", units: 3_200 }]);
    expect(quota.remainingUploads).toBe(4);
  });

  it("reads another day's ledger as unreadable rather than showing yesterday's spend", () => {
    const quota = youtubeQuota(used, NOW, testConfig(), ledgerOf({ inbox: 150 }, { day: "2026-07-07" }));

    expect(quota.ledgerReadable).toBe(false);
    expect(quota.split).toEqual([{ purpose: "upload", units: 3_200 }]);
  });
});
