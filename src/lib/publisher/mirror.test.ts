import { describe, expect, it } from "vitest";
import { dealDistinctOrders, describeMirrorPlan, leadSchedule, planMirror, planUnmirror, shuffled } from "@/lib/publisher/mirror";
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
    expect(plan.additions.filter((a) => a.platform === "instagram")).toEqual([{ itemId: "b", platform: "instagram" }]);
  });

  it("mirrors to the Facebook Page wherever it mirrors to Instagram", () => {
    const plan = planMirror(SCHEDULE, { targets: ["instagram"], now: NOW });
    expect(plan.additions.filter((a) => a.platform === "facebook").map((a) => a.itemId)).toEqual(["a", "b", "c"]);
  });

  it("never mirrors the lead platform onto itself", () => {
    const plan = planMirror(SCHEDULE, { targets: ["youtube", "instagram"], now: NOW });
    expect(plan.additions.every((a) => a.platform !== "youtube")).toBe(true);
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

describe("dealDistinctOrders", () => {
  const clips = Array.from({ length: 26 }, (_, i) => `clip-${i}`);

  it("gives every platform a full permutation of the clips", () => {
    const orders = dealDistinctOrders(clips, ["instagram", "facebook"], 5, clips);
    for (const order of orders.values()) {
      expect([...order].sort()).toEqual([...clips].sort());
    }
  });

  // The whole point: no instant may carry the same clip on two platforms, and
  // an independent shuffle alone leaves roughly one such collision per pass.
  it("never puts one clip in the same slot on two platforms", () => {
    const orders = dealDistinctOrders(clips, ["instagram", "facebook"], 5, clips);
    clips.forEach((leadClip, index) => {
      const atSlot = [leadClip, ...[...orders.values()].map((order) => order[index])];
      expect(new Set(atSlot).size).toBe(atSlot.length);
    });
  });

  it("holds for many seeds, not just a lucky one", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const orders = dealDistinctOrders(clips, ["instagram", "facebook", "tiktok"], seed, clips);
      clips.forEach((leadClip, index) => {
        const atSlot = [leadClip, ...[...orders.values()].map((order) => order[index])];
        expect(new Set(atSlot).size).toBe(atSlot.length);
      });
    }
  });

  it("still deals differently for each platform", () => {
    const orders = dealDistinctOrders(clips, ["instagram", "facebook"], 5, clips);
    expect(orders.get("instagram")).not.toEqual(orders.get("facebook"));
  });

  it("repeats exactly for the same seed", () => {
    expect(dealDistinctOrders(clips, ["instagram"], 11, clips)).toEqual(
      dealDistinctOrders(clips, ["instagram"], 11, clips)
    );
  });
});

describe("planMirror — shuffle keeps every instant distinct", () => {
  it("gives each platform a different clip at every slot", () => {
    const schedule = Array.from({ length: 12 }, (_, i) =>
      item(`c${i}`, `2026-08-${String(i + 2).padStart(2, "0")}T14:00:00.000Z`)
    );
    const plan = planMirror(schedule, {
      targets: ["instagram", "facebook"],
      mode: "shuffle",
      now: NOW,
      seed: 3
    });
    const bySlot = new Map<string, string[]>();
    for (const entry of plan.newItems) {
      bySlot.set(entry.publishAt, [...(bySlot.get(entry.publishAt) ?? []), entry.sourceItemId]);
    }
    for (const slotItem of schedule) {
      const atSlot = [slotItem.id, ...(bySlot.get(slotItem.publishAt) ?? [])];
      expect(new Set(atSlot).size).toBe(atSlot.length);
    }
  });
});

describe("planUnmirror", () => {
  it("lifts off target platforms the runner never touched", () => {
    const items = [item("a", "2026-08-01T14:00:00.000Z", { youtube: "scheduled", instagram: "pending", facebook: "pending" })];
    const { removals, kept } = planUnmirror(items, ["instagram", "facebook"], NOW);
    expect(removals).toEqual([
      { itemId: "a", platform: "instagram" },
      { itemId: "a", platform: "facebook" }
    ]);
    expect(kept).toEqual([]);
  });

  // Removing one of these would erase the only record that a post went out.
  it("keeps anything that already reached the platform", () => {
    const items = [item("a", "2026-08-01T14:00:00.000Z", { youtube: "scheduled", instagram: "published" })];
    const { removals, kept } = planUnmirror(items, ["instagram"], NOW);
    expect(removals).toEqual([]);
    expect(kept[0].reason).toContain("already published");
  });

  it("keeps a pending state that has already been attempted", () => {
    const items = [item("a", "2026-08-01T14:00:00.000Z", { youtube: "scheduled" })];
    items[0].platforms.instagram = { status: "pending", attempts: 2 };
    const { removals, kept } = planUnmirror(items, ["instagram"], NOW);
    expect(removals).toEqual([]);
    expect(kept).toHaveLength(1);
  });

  it("keeps a pending state that already has a container", () => {
    const items = [item("a", "2026-08-01T14:00:00.000Z", { youtube: "scheduled" })];
    items[0].platforms.instagram = { status: "pending", attempts: 0, containerId: "c1" };
    const { removals } = planUnmirror(items, ["instagram"], NOW);
    expect(removals).toEqual([]);
  });

  it("never touches a slot that has already passed", () => {
    const items = [item("old", "2026-07-01T14:00:00.000Z", { youtube: "published", instagram: "pending" })];
    expect(planUnmirror(items, ["instagram"], NOW).removals).toEqual([]);
  });

  it("leaves the lead platform alone", () => {
    const items = [item("a", "2026-08-01T14:00:00.000Z", { youtube: "pending", instagram: "pending" })];
    const { removals } = planUnmirror(items, ["instagram"], NOW);
    expect(removals.every((r) => r.platform !== "youtube")).toBe(true);
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

describe("planMirror — shuffle never deals a clip a platform already carries", () => {
  // The live queue had the same short booked to the Page two, three and five
  // times. Shuffle only remembered which SLOTS a platform occupied, so a clip
  // it already carried was dealt again into any slot that happened to be free,
  // and every mirror pass found more free slots.
  const alreadyOnFacebook: QueueItem = {
    ...item("fb-copy-of-a", "2026-09-20T14:00:00.000Z", { facebook: "pending" }),
    clipPath: "clips/a.mp4"
  };

  it("skips the clip and says why, rather than booking it twice", () => {
    const plan = planMirror([...SCHEDULE, alreadyOnFacebook], {
      targets: ["facebook"],
      mode: "shuffle",
      now: NOW,
      seed: 7
    });

    const dealt = plan.newItems.filter((entry) => entry.platform === "facebook").map((entry) => entry.sourceItemId);
    expect(dealt).not.toContain("a");
    expect(plan.skipped.some((skip) => skip.itemId === "a" && /already booked on facebook/.test(skip.reason))).toBe(true);
  });

  it("still deals the clips that platform does not have", () => {
    const plan = planMirror([...SCHEDULE, alreadyOnFacebook], {
      targets: ["facebook"],
      mode: "shuffle",
      now: NOW,
      seed: 7
    });

    expect([...plan.newItems.map((entry) => entry.sourceItemId)].sort()).toEqual(["b", "c"]);
  });

  it("re-running the mirror adds nothing the second time", () => {
    const first = planMirror(SCHEDULE, { targets: ["facebook"], mode: "shuffle", now: NOW, seed: 7 });
    // What the runner would have written for each dealt clip.
    const written: QueueItem[] = first.newItems.map((entry, index) => ({
      ...item(`written-${index}`, entry.publishAt, { facebook: "pending" }),
      clipPath: `clips/${entry.sourceItemId}.mp4`
    }));

    const second = planMirror([...SCHEDULE, ...written], {
      targets: ["facebook"],
      mode: "shuffle",
      now: NOW,
      seed: 7
    });

    expect(second.newItems).toEqual([]);
  });
});
