import { describe, expect, it } from "vitest";
import { DEFAULT_REVIEW_POLICY, legAwaitingApproval } from "@/lib/publisher/approval";
import { rearmItem } from "@/lib/publisher/rearm";
import { testItem } from "@/lib/publisher/test-helpers";

const hold = { ...DEFAULT_REVIEW_POLICY, instagram: "hold" as const };
const NOW = new Date("2026-08-10T16:00:00.000Z");

describe("a re-arm under a held channel", () => {
  it("keeps a failed leg that was already sent once released", () => {
    const item = testItem({ platformIds: ["instagram"] });
    item.platforms.instagram = { status: "failed", attempts: 3, error: "boom", lastFailedAt: "2026-08-09T10:00:00.000Z" };
    expect(rearmItem(item, { now: NOW, keepReleased: () => true })).toEqual(["instagram"]);
    expect(item.platforms.instagram).toMatchObject({ status: "pending", attempts: 0, approvedAt: NOW.toISOString() });
    expect(legAwaitingApproval(item.platforms.instagram!, "instagram", hold)).toBe(false);
  });

  it("keeps the approval a failed leg already had", () => {
    const item = testItem({ platformIds: ["instagram"] });
    item.platforms.instagram = { status: "failed", attempts: 3, error: "boom", approvedAt: "2026-08-09T08:00:00.000Z" };
    rearmItem(item, { now: NOW, keepReleased: () => true });
    expect(item.platforms.instagram?.approvedAt).toBe("2026-08-09T08:00:00.000Z");
  });

  it("leaves a leg that was never sent waiting for approval, as Threads does", () => {
    const item = testItem({ platformIds: ["instagram"] });
    item.platforms.instagram = { status: "manual", attempts: 0, note: "not connected" };
    rearmItem(item, { now: NOW, keepReleased: () => true });
    expect(item.platforms.instagram?.approvedAt).toBeUndefined();
    expect(legAwaitingApproval(item.platforms.instagram!, "instagram", hold)).toBe(true);
  });
});

describe("a re-arm under the default policy", () => {
  it("writes nothing new on the leg", () => {
    const item = testItem({ platformIds: ["instagram"] });
    item.platforms.instagram = { status: "failed", attempts: 3, error: "boom", lastFailedAt: "2026-08-09T10:00:00.000Z" };
    rearmItem(item, { now: NOW });
    expect(item.platforms.instagram?.approvedAt).toBeUndefined();
  });
});
