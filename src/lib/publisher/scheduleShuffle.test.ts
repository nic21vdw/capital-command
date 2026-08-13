import { describe, expect, it } from "vitest";
import { newPlatformState } from "@/lib/publisher/queue";
import {
  applyScheduleShuffle,
  laneDemand,
  occupancyOf,
  planScheduleRepair,
  planScheduleShuffle,
  sourceOf
} from "@/lib/publisher/scheduleShuffle";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";

const NOW = new Date("2026-08-12T16:00:00.000Z");

function item(id: string, publishAt: string, extras: Partial<QueueItem> = {}): QueueItem {
  return {
    id,
    clipPath: `data/clips/${id}.mp4`,
    title: id,
    caption: id,
    hashtags: [],
    publishAt,
    visibility: "public",
    createdAt: "2026-08-01T00:00:00.000Z",
    platforms: { youtube: newPlatformState() },
    ...extras
  };
}

function on(platforms: PlatformId[]): Pick<QueueItem, "platforms"> {
  return { platforms: Object.fromEntries(platforms.map((platform) => [platform, newPlatformState()])) };
}

/** Every `platform@account` that would post more than once at one instant. */
function doubleBooked(items: QueueItem[]): string[] {
  const seen = new Map<string, number>();
  for (const entry of items) {
    for (const key of occupancyOf(entry)) {
      const at = `${entry.publishAt}|${key}`;
      seen.set(at, (seen.get(at) ?? 0) + 1);
    }
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([at]) => at);
}

function backToBack(items: QueueItem[]): number {
  const order = [...items].sort((a, b) => a.publishAt.localeCompare(b.publishAt));
  let count = 0;
  for (let index = 1; index < order.length; index += 1) {
    if (sourceOf(order[index]) === sourceOf(order[index - 1])) count += 1;
  }
  return count;
}

const DAYS = ["13", "14", "15", "16", "17", "18", "19", "20"];
const HOURS = ["11:30", "16:30", "23:30"];

/** A fortnight of slots, three a day, dealt out of four streams in blocks. */
function groupedSchedule(): QueueItem[] {
  const items: QueueItem[] = [];
  let index = 0;
  for (const day of DAYS) {
    for (const hour of HOURS) {
      items.push(
        item(`s${index}`, `2026-08-${day}T${hour}:00.000Z`, { jobId: `stream-${Math.floor(index / 6)}` })
      );
      index += 1;
    }
  }
  return items;
}

describe("planScheduleShuffle", () => {
  it("reassigns the same upcoming slots in a different order", () => {
    const items = [
      item("a", "2026-08-13T11:30:00.000Z", { jobId: "one" }),
      item("b", "2026-08-13T16:30:00.000Z", { jobId: "two" }),
      item("c", "2026-08-13T23:30:00.000Z", { jobId: "three" }),
      item("d", "2026-08-14T11:30:00.000Z", { jobId: "four" })
    ];
    const plan = planScheduleShuffle(items, NOW, { seed: 7 });
    const next = applyScheduleShuffle(items, plan);
    const upcoming = [...next].sort((a, b) => a.publishAt.localeCompare(b.publishAt));
    expect(upcoming.map((entry) => entry.publishAt)).toEqual(items.map((entry) => entry.publishAt));
    expect(upcoming.map((entry) => entry.id).join("")).not.toBe("abcd");
    expect(plan.moves.length + plan.unchanged).toBe(4);
  });

  it("never puts one stream in two slots in a row", () => {
    const items = groupedSchedule();
    expect(backToBack(items)).toBeGreaterThan(15);
    for (let seed = 1; seed <= 25; seed += 1) {
      const plan = planScheduleShuffle(items, NOW, { seed });
      expect(plan.repeats).toEqual([]);
      expect(backToBack(applyScheduleShuffle(items, plan))).toBe(0);
    }
  });

  it("never lands two posts for one platform on the same instant", () => {
    // What mirror.ts produces: one slot, four items, a different platform each.
    const slots = ["2026-08-13T11:30:00.000Z", "2026-08-13T16:30:00.000Z", "2026-08-14T11:30:00.000Z"];
    const platforms: PlatformId[] = ["youtube", "instagram", "tiktok", "facebook"];
    const items = slots.flatMap((publishAt, slot) =>
      platforms.map((platform, lane) =>
        item(`s${slot}-${platform}`, publishAt, { jobId: `stream-${lane}`, ...on([platform]) })
      )
    );
    expect(doubleBooked(items)).toEqual([]);
    for (let seed = 1; seed <= 25; seed += 1) {
      const plan = planScheduleShuffle(items, NOW, { seed });
      expect(plan.collisions).toEqual([]);
      expect(doubleBooked(applyScheduleShuffle(items, plan))).toEqual([]);
    }
  });

  it("treats two accounts on one platform as two lanes, not a collision", () => {
    const items = [
      item("first", "2026-08-13T11:30:00.000Z", { accountId: "main", jobId: "one", ...on(["instagram"]) }),
      item("second", "2026-08-13T11:30:00.000Z", { accountId: "alt", jobId: "two", ...on(["instagram"]) })
    ];
    const plan = planScheduleShuffle(items, NOW, { seed: 5 });
    expect(plan.collisions).toEqual([]);
  });

  it("leaves past items on their original times", () => {
    const items = [item("old", "2026-08-11T11:30:00.000Z"), item("next", "2026-08-13T11:30:00.000Z")];
    const plan = planScheduleShuffle(items, NOW, { seed: 3 });
    expect(plan.moves.some((move) => move.id === "old")).toBe(false);
    expect(applyScheduleShuffle(items, plan)[0].publishAt).toBe("2026-08-11T11:30:00.000Z");
  });

  it("can leave already-uploaded YouTube videos where they are", () => {
    const items = [
      item("live", "2026-08-13T11:30:00.000Z", {
        jobId: "one",
        platforms: { youtube: { status: "scheduled", attempts: 0, postId: "abc" } }
      }),
      item("wait", "2026-08-13T16:30:00.000Z", { jobId: "two" }),
      item("later", "2026-08-13T23:30:00.000Z", { jobId: "three" })
    ];
    const plan = planScheduleShuffle(items, NOW, { seed: 11, onlyPending: true });
    expect(plan.moves.some((move) => move.id === "live")).toBe(false);
    const next = applyScheduleShuffle(items, plan);
    expect(next.find((entry) => entry.id === "live")?.publishAt).toBe("2026-08-13T11:30:00.000Z");
    expect(new Set(next.map((entry) => entry.publishAt)).size).toBe(3);
  });

  it("will not book a pending post onto a platform an untouchable video already holds", () => {
    const at = "2026-08-13T11:30:00.000Z";
    const items = [
      item("live", at, {
        jobId: "one",
        platforms: { youtube: { status: "scheduled", attempts: 0, postId: "abc" } }
      }),
      item("pending", "2026-08-13T16:30:00.000Z", { jobId: "two", ...on(["youtube"]) })
    ];
    for (let seed = 1; seed <= 25; seed += 1) {
      const next = applyScheduleShuffle(items, planScheduleShuffle(items, NOW, { seed, onlyPending: true }));
      expect(next.find((entry) => entry.id === "pending")?.publishAt).not.toBe(at);
      expect(doubleBooked(next)).toEqual([]);
    }
  });

  it("is deterministic for a given seed", () => {
    const items = groupedSchedule();
    expect(planScheduleShuffle(items, NOW, { seed: 42 }).moves).toEqual(
      planScheduleShuffle(items, NOW, { seed: 42 }).moves
    );
  });
});

describe("planScheduleRepair", () => {
  /** One slot carrying two YouTube posts — what the unconstrained shuffle made. */
  function collided(): QueueItem[] {
    return [
      item("clash-a", "2026-08-13T11:30:00.000Z", { jobId: "one", ...on(["youtube"]) }),
      item("clash-b", "2026-08-13T11:30:00.000Z", { jobId: "two", ...on(["youtube"]) }),
      item("free-a", "2026-08-14T11:30:00.000Z", { jobId: "three", ...on(["instagram"]) }),
      item("free-b", "2026-08-14T11:30:00.000Z", { jobId: "four", ...on(["tiktok"]) })
    ];
  }

  it("clears the double-booking", () => {
    const items = collided();
    expect(doubleBooked(items)).toEqual(["2026-08-13T11:30:00.000Z|youtube@"]);
    const plan = planScheduleRepair(items, NOW, { seed: 4 });
    expect(plan.collisions).toEqual([]);
    expect(doubleBooked(applyScheduleShuffle(items, plan))).toEqual([]);
  });

  it("moves as little as it can", () => {
    const plan = planScheduleRepair(collided(), NOW, { seed: 4 });
    expect(plan.moves.length).toBeLessThanOrEqual(2);
    expect(plan.moves.some((move) => move.id === "free-a" && move.to === move.from)).toBe(false);
  });

  it("never moves a video already uploaded to YouTube", () => {
    const items = [
      ...collided(),
      item("live", "2026-08-15T11:30:00.000Z", {
        jobId: "five",
        platforms: { youtube: { status: "scheduled", attempts: 0, postId: "abc" } }
      })
    ];
    for (let seed = 1; seed <= 25; seed += 1) {
      const plan = planScheduleRepair(items, NOW, { seed });
      expect(plan.moves.some((move) => move.id === "live")).toBe(false);
    }
  });

  /** Three Facebook posts, two instants — no permutation can separate them. */
  function oversubscribed(): QueueItem[] {
    return [
      item("a", "2026-08-13T11:30:00.000Z", { jobId: "one", ...on(["facebook"]) }),
      item("b", "2026-08-13T11:30:00.000Z", { jobId: "two", ...on(["facebook"]) }),
      item("c", "2026-08-14T11:30:00.000Z", { jobId: "three", ...on(["facebook"]) })
    ];
  }

  it("counts a lane wanting more posts than the instants it is booked across", () => {
    const demand = laneDemand(oversubscribed(), NOW);
    expect(demand.instants).toBe(2);
    expect(demand.lanes).toEqual([{ lane: "facebook@", wanted: 3, over: 1 }]);
  });

  it("gives the overflow a later slot instead of calling it impossible", () => {
    const items = oversubscribed();
    const plan = planScheduleRepair(items, NOW, {
      seed: 6,
      openSlots: ["2026-08-15T11:30:00.000Z", "2026-08-16T11:30:00.000Z"]
    });
    expect(plan.collisions).toEqual([]);
    const next = applyScheduleShuffle(items, plan);
    expect(doubleBooked(next)).toEqual([]);
    expect(next.map((entry) => entry.publishAt)).toContain("2026-08-15T11:30:00.000Z");
  });

  it("takes the earliest free instant it is offered, not the furthest", () => {
    const plan = planScheduleRepair(oversubscribed(), NOW, {
      seed: 6,
      openSlots: ["2026-08-20T11:30:00.000Z", "2026-08-15T11:30:00.000Z"]
    });
    expect(plan.moves.map((move) => move.to)).toContain("2026-08-15T11:30:00.000Z");
  });

  it("only reports a conflict when it was given nowhere to put the overflow", () => {
    expect(planScheduleRepair(oversubscribed(), NOW, { seed: 6 }).collisions).toHaveLength(1);
  });

  it("leaves a schedule that is already clean alone", () => {
    const items = [
      item("a", "2026-08-13T11:30:00.000Z", { jobId: "one" }),
      item("b", "2026-08-14T11:30:00.000Z", { jobId: "two" }),
      item("c", "2026-08-15T11:30:00.000Z", { jobId: "three" })
    ];
    expect(planScheduleRepair(items, NOW, { seed: 9 }).moves).toEqual([]);
  });
});
