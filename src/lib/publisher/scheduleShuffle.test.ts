import { describe, expect, it } from "vitest";
import { newPlatformState } from "@/lib/publisher/queue";
import { applyScheduleShuffle, planScheduleShuffle } from "@/lib/publisher/scheduleShuffle";
import type { QueueItem } from "@/lib/publisher/types";

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

describe("planScheduleShuffle", () => {
  it("reassigns the same upcoming slots in a different order", () => {
    const items = [
      item("a", "2026-08-13T11:30:00.000Z"),
      item("b", "2026-08-13T16:30:00.000Z"),
      item("c", "2026-08-13T23:30:00.000Z"),
      item("d", "2026-08-14T11:30:00.000Z")
    ];
    const plan = planScheduleShuffle(items, NOW, { seed: 7 });
    const next = applyScheduleShuffle(items, plan);
    const upcoming = [...next]
      .filter((entry) => new Date(entry.publishAt).getTime() > NOW.getTime())
      .sort((a, b) => a.publishAt.localeCompare(b.publishAt));
    expect(upcoming.map((entry) => entry.publishAt)).toEqual(items.map((entry) => entry.publishAt));
    expect(upcoming.map((entry) => entry.id).join("")).not.toBe("abcd");
    expect(plan.moves.length + plan.unchanged).toBe(4);
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
        platforms: { youtube: { status: "scheduled", attempts: 0, postId: "abc" } }
      }),
      item("wait", "2026-08-13T16:30:00.000Z"),
      item("later", "2026-08-13T23:30:00.000Z")
    ];
    const plan = planScheduleShuffle(items, NOW, { seed: 11, onlyPending: true });
    expect(plan.moves.some((move) => move.id === "live")).toBe(false);
    const next = applyScheduleShuffle(items, plan);
    expect(next.find((entry) => entry.id === "live")?.publishAt).toBe("2026-08-13T11:30:00.000Z");
    expect(new Set(next.map((entry) => entry.publishAt)).size).toBe(3);
  });

  it("is deterministic for a given seed", () => {
    const items = [
      item("a", "2026-08-13T11:30:00.000Z"),
      item("b", "2026-08-13T16:30:00.000Z"),
      item("c", "2026-08-13T23:30:00.000Z")
    ];
    const once = planScheduleShuffle(items, NOW, { seed: 42 });
    const twice = planScheduleShuffle(items, NOW, { seed: 42 });
    expect(once.moves).toEqual(twice.moves);
  });
});
