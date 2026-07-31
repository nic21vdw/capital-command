import { describe, expect, it } from "vitest";
import { describeMirrorPlan, leadSchedule, planMirror, shuffled } from "@/lib/publisher/mirror";
import type { PlatformId, PlatformStatus, QueueItem, Visibility } from "@/lib/publisher/types";

/**
 * The rule these pin down: YouTube owns the calendar and everyone else copies
 * it — the same slots, either the same clip in each (match) or the same clips
 * dealt out in a different order (shuffle) — and copying twice never doubles a
 * post up.
 */

const NOW = new Date("2026-07-31T00:00:00.000Z");

function item(
  id: string,
  publishAt: string,
  platforms: Partial<Record<PlatformId, PlatformStatus>> = { youtube: "scheduled" },
  visibility: Visibility = "public"
): QueueItem {
  return {
    id,
    clipPath: `clips/${id}.mp4`,
    title: `Clip ${id}`,
    caption: "caption",
    hashtags: [],
    publishAt,
    visibility,
    createdAt: "2026-07-01T00:00:00.000Z",
    platforms: Object.fromEntries(
      Object.entries(platforms).map(([platform, status]) => [platform, { status, attempts: 0 }])
    )
  };
}

const SCHEDULE = [
  item("a", "2026-08-01T14:00:00.000Z"),
  item("b", "2026-08-01T17:00:00.000Z"),
  item("c", "2026-08-02T14:00:00.000Z")
];

describe("leadSchedule", () => {
  it("takes the lead platform's future slots, oldest first", () => {
    const items = [...SCHEDULE, item("past", "2026-07-30T14:00:00.000Z")];
    expect(leadSchedule(items, "youtube", NOW).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("ignores items the lead platform isn't on, and ones it failed", () => {
    const items = [
      item("tiktok-only", "2026-08-01T14:00:00.000Z", { tiktok: "pending" }),
      item("dead", "2026-08-01T15:00:00.000Z", { youtube: "failed" }),
      item("live", "2026-08-01T16:00:00.000Z")
    ];
    expect(leadSchedule(items, "youtube", NOW).map((i) => i.id)).toEqual(["live"]);
  });

  // A YouTube upload that already went through still owns its slot — the other
  // platforms have no native scheduling and post at the slot time themselves.
  it("keeps a slot whose lead platform already published", () => {
    const items = [item("done", "2026-08-01T14:00:00.000Z", { youtube: "published" })];
    expect(leadSchedule(items, "youtube", NOW).map((i) => i.id)).toEqual(["done"]);
  });
});

describe("planMirror — match", () => {
  it("adds the missing platforms to every upcoming slot", () => {
    const plan = planMirror(SCHEDULE, { targets: ["instagram", "facebook"], now: NOW });
    expect(plan.newItems).toEqual([]);
    expect(plan.additions).toHaveLength(6);
    expect(plan.additions.filter((a) => a.platform === "instagram").map((a) => a.itemId)).toEqual(["a", "b", "c"]);
    expect(describeMirrorPlan(plan)).toBe("instagram +3, facebook +3");
  });

  it("is idempotent — a platform already on the item is left alone", () => {
    const items = [
      item("a", "2026-08-01T14:00:00.000Z", { youtube: "scheduled", instagram: "pending" }),
      item("b", "2026-08-01T17:00:00.000Z")
    ];
    const plan = planMirror(items, { targets: ["instagram"], now: NOW });
    expect(plan.additions).toEqual([{ itemId: "b", platform: "instagram" }]);
  });

  it("never mirrors the lead platform onto itself", () => {
    const plan = planMirror(SCHEDULE, { targets: ["youtube", "instagram"], now: NOW });
    expect(plan.additions.every((a) => a.platform === "instagram")).toBe(true);
  });

  // The IG/FB adapters refuse a non-public post; catching it here turns a
  // failed upload hours later into a line in the plan.
  it("reports a non-public clip instead of queueing it to fail", () => {
    const items = [item("private", "2026-08-01T14:00:00.000Z", { youtube: "scheduled" }, "private")];
    const plan = planMirror(items, { targets: ["instagram"], now: NOW });
    expect(plan.additions).toEqual([]);
    expect(plan.skipped[0]).toMatchObject({ itemId: "private" });
    expect(plan.skipped[0].reason).toContain("public");
  });

  it("still mirrors a non-public clip to TikTok, which allows it", () => {
    const items = [item("private", "2026-08-01T14:00:00.000Z", { youtube: "scheduled" }, "private")];
    const plan = planMirror(items, { targets: ["tiktok"], now: NOW });
    expect(plan.additions).toEqual([{ itemId: "private", platform: "tiktok" }]);
  });
});

describe("planMirror — shuffle", () => {
  it("fills the same slots with the same clips in a different order", () => {
    const plan = planMirror(SCHEDULE, { targets: ["instagram"], mode: "shuffle", now: NOW, seed: 7 });
    expect(plan.additions).toEqual([]);
    expect(plan.newItems.map((n) => n.publishAt)).toEqual(SCHEDULE.map((i) => i.publishAt));
    // Every clip is dealt exactly once — a permutation, not a resample.
    expect([...plan.newItems.map((n) => n.sourceItemId)].sort()).toEqual(["a", "b", "c"]);
  });

  it("deals each platform its own order", () => {
    const plan = planMirror(SCHEDULE, {
      targets: ["instagram", "facebook"],
      mode: "shuffle",
      now: NOW,
      seed: 7
    });
    const ig = plan.newItems.filter((n) => n.platform === "instagram").map((n) => n.sourceItemId);
    const fb = plan.newItems.filter((n) => n.platform === "facebook").map((n) => n.sourceItemId);
    expect(ig).not.toEqual(fb);
  });

  it("repeats exactly for the same seed", () => {
    const once = planMirror(SCHEDULE, { targets: ["instagram"], mode: "shuffle", now: NOW, seed: 42 });
    const twice = planMirror(SCHEDULE, { targets: ["instagram"], mode: "shuffle", now: NOW, seed: 42 });
    expect(once.newItems).toEqual(twice.newItems);
  });

  it("leaves slots the platform already fills, so a re-run adds nothing", () => {
    const items = [
      ...SCHEDULE,
      item("ig-a", "2026-08-01T14:00:00.000Z", { instagram: "pending" }),
      item("ig-b", "2026-08-01T17:00:00.000Z", { instagram: "pending" }),
      item("ig-c", "2026-08-02T14:00:00.000Z", { instagram: "pending" })
    ];
    const plan = planMirror(items, { targets: ["instagram"], mode: "shuffle", now: NOW, seed: 7 });
    expect(plan.newItems).toEqual([]);
  });
});

describe("shuffled", () => {
  it("keeps every element exactly once", () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    const out = shuffled(input, 3);
    expect([...out].sort((a, b) => a - b)).toEqual(input);
    expect(out).not.toEqual(input);
  });

  it("does not mutate its input", () => {
    const input = [1, 2, 3, 4, 5];
    shuffled(input, 9);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
});
