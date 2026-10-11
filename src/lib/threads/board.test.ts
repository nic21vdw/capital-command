import { describe, expect, it } from "vitest";
import { defaultBatchDate, numberBatchPosts } from "@/lib/threads/board";

describe("defaultBatchDate", () => {
  const dates = ["2026-10-12", "2026-10-11", "2026-10-10"];

  it("opens on today, not on the newest batch (tomorrow's)", () => {
    expect(defaultBatchDate({ dates, today: "2026-10-11" })).toBe("2026-10-11");
  });

  it("lets ?date= and then a picked pill win, when they exist", () => {
    expect(defaultBatchDate({ dates, today: "2026-10-11", requested: "2026-10-10" })).toBe("2026-10-10");
    expect(defaultBatchDate({ dates, today: "2026-10-11", requested: "2026-10-10", picked: "2026-10-12" })).toBe("2026-10-12");
    expect(defaultBatchDate({ dates, today: "2026-10-11", requested: "2030-01-01", picked: "nope" })).toBe("2026-10-11");
  });

  it("falls back to the latest earlier day, then the soonest later one, then today", () => {
    expect(defaultBatchDate({ dates: ["2026-10-12", "2026-10-09"], today: "2026-10-11" })).toBe("2026-10-09");
    expect(defaultBatchDate({ dates: ["2026-10-14", "2026-10-12"], today: "2026-10-11" })).toBe("2026-10-12");
    expect(defaultBatchDate({ dates: [], today: "2026-10-11" })).toBe("2026-10-11");
  });
});

describe("numberBatchPosts", () => {
  it("numbers posts 1..N in sending order, once, however many accounts send them", () => {
    const items = [
      { id: "a-4", slot: 4, publishAt: "2026-10-11T20:05:00.000Z" },
      { id: "b-4", slot: 4, publishAt: "2026-10-11T20:08:00.000Z" },
      { id: "a-1", slot: 1, publishAt: "2026-10-11T12:10:00.000Z" },
      { id: "b-1", slot: 1, publishAt: "2026-10-11T12:13:00.000Z" },
      { id: "a-2", slot: 2, publishAt: "2026-10-11T14:50:00.000Z" },
      { id: "mine", slot: 0, origin: "pipeline" as const, publishAt: "2026-10-11T06:04:00.000Z" }
    ];
    const numbers = numberBatchPosts(items);
    expect(items.map((item) => numbers.get(item.id))).toEqual([4, 4, 2, 2, 3, 1]);
    expect(new Set(numbers.values())).toEqual(new Set([1, 2, 3, 4]));
  });

  it("keeps two hand-added posts apart even though both carry slot 0", () => {
    const numbers = numberBatchPosts([
      { id: "x", slot: 0, origin: "pipeline", publishAt: "2026-10-11T10:00:00.000Z" },
      { id: "y", slot: 0, origin: "pipeline", publishAt: "2026-10-11T11:00:00.000Z" }
    ]);
    expect([numbers.get("x"), numbers.get("y")]).toEqual([1, 2]);
  });

  it("numbers by sending order even when the pack wrapped past midnight", () => {
    const numbers = numberBatchPosts([
      { id: "late", slot: 1, publishAt: "2026-10-12T02:20:00.000Z" },
      { id: "early", slot: 2, publishAt: "2026-10-11T09:05:00.000Z" }
    ]);
    expect(numbers.get("early")).toBe(1);
    expect(numbers.get("late")).toBe(2);
  });
});
