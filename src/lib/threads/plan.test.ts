import { describe, expect, it } from "vitest";
import { threadsConfig, type ThreadsConfig } from "@/lib/threads/config";
import { fitToThreads, planBatch } from "@/lib/threads/plan";
import type { XDailyPack } from "@/types/domain";

function config(overrides: Partial<ThreadsConfig> = {}): ThreadsConfig {
  return { ...threadsConfig(), timezone: "UTC", userId: "1", accessToken: "t", ...overrides };
}

function pack(overrides: Partial<XDailyPack> = {}): XDailyPack {
  return {
    id: "xpack-1",
    date: "2026-07-22",
    source: "ai",
    posts: [
      {
        id: "xpost-1",
        slot: 1,
        time: "07:15",
        format: "insight",
        topic: "verification",
        text: "The X flavoured line",
        threadsVariant: "The warmer Threads rewrite"
      },
      {
        id: "xpost-2",
        slot: 2,
        time: "09:40",
        format: "contrarian",
        topic: "cost of code",
        text: "Second X line",
        threadsVariant: "Second Threads rewrite"
      }
    ],
    replies: [],
    createdAt: "2026-07-22T06:00:00.000Z",
    ...overrides
  };
}

const beforeTheDay = new Date("2026-07-22T06:00:00.000Z");

describe("planBatch", () => {
  it("schedules both versions of every slot, main first", () => {
    const { items } = planBatch({ pack: pack(), config: config(), now: beforeTheDay });

    expect(items).toHaveLength(4);
    expect(items.filter((item) => item.role === "main").map((item) => item.text)).toEqual([
      "The X flavoured line",
      "Second X line"
    ]);
    expect(items.filter((item) => item.role === "variant").map((item) => item.text)).toEqual([
      "The warmer Threads rewrite",
      "Second Threads rewrite"
    ]);
  });

  it("puts the main post at the pack's wall-clock slot time in the configured zone", () => {
    const { items } = planBatch({ pack: pack(), config: config(), now: beforeTheDay });
    expect(items[0].publishAt).toBe("2026-07-22T07:15:00.000Z");
  });

  it("posts the variant as a reply under its main, a few minutes later", () => {
    const { items } = planBatch({
      pack: pack(),
      config: config({ secondPostGapMinutes: 3 }),
      now: beforeTheDay
    });
    const [main, variant] = items;

    expect(variant.replyToItemId).toBe(main.id);
    expect(new Date(variant.publishAt).getTime() - new Date(main.publishAt).getTime()).toBe(3 * 60_000);
  });

  it("leaves the variant unlinked when it should stand on its own", () => {
    const { items } = planBatch({ pack: pack(), config: config({ secondPost: "standalone" }), now: beforeTheDay });
    expect(items[1].role).toBe("variant");
    expect(items[1].replyToItemId).toBeUndefined();
  });

  it("schedules only the main post when the second version is off", () => {
    const { items } = planBatch({ pack: pack(), config: config({ secondPost: "off" }), now: beforeTheDay });
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.role === "main")).toBe(true);
  });

  it("drops slots whose time has already passed rather than backdating them", () => {
    const { items, droppedPastSlots } = planBatch({
      pack: pack(),
      config: config(),
      now: new Date("2026-07-22T08:00:00.000Z")
    });

    expect(droppedPastSlots).toBe(1);
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.slot === 2)).toBe(true);
    expect(items.every((item) => new Date(item.publishAt) > new Date("2026-07-22T08:00:00.000Z"))).toBe(true);
  });

  it("honours the per-day cap", () => {
    const { items } = planBatch({ pack: pack(), config: config({ postsPerDay: 1 }), now: beforeTheDay });
    expect(items.map((item) => item.slot)).toEqual([1, 1]);
  });

  it("carries the batch date, topic and format onto every item", () => {
    const { items } = planBatch({ pack: pack(), config: config(), now: beforeTheDay });
    expect(items[0]).toMatchObject({
      batchDate: "2026-07-22",
      slot: 1,
      topic: "verification",
      format: "insight",
      status: "pending",
      attempts: 0
    });
  });
});

describe("fitToThreads", () => {
  it("leaves a normal post untouched", () => {
    expect(fitToThreads("  a normal post  ")).toBe("a normal post");
  });

  it("trims an over-long post on a word boundary", () => {
    const long = `${"word ".repeat(120)}end`;
    const fitted = fitToThreads(long);
    expect(fitted.length).toBeLessThanOrEqual(500);
    expect(fitted.endsWith("word")).toBe(true);
  });

  it("still cuts text with no spaces to fit", () => {
    expect(fitToThreads("x".repeat(600))).toHaveLength(500);
  });
});
