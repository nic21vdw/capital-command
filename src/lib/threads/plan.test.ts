import { describe, expect, it } from "vitest";
import { threadsConfig, type ThreadsAccount, type ThreadsConfig } from "@/lib/threads/config";
import { fitToThreads, planBatch } from "@/lib/threads/plan";
import type { XDailyPack } from "@/types/domain";

function account(overrides: Partial<ThreadsAccount> = {}): ThreadsAccount {
  return {
    id: "primary",
    label: "primary",
    userId: "1",
    accessToken: "token",
    posts: "text",
    offsetMinutes: 0,
    ...overrides
  };
}

const BOTH_ACCOUNTS = [
  account(),
  account({ id: "secondary", label: "secondary", userId: "2", posts: "variant", offsetMinutes: 3 })
];

function config(overrides: Partial<ThreadsConfig> = {}): ThreadsConfig {
  return { ...threadsConfig(), timezone: "UTC", accounts: BOTH_ACCOUNTS, ...overrides };
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
        text: "The punchy line",
        threadsVariant: "The warmer rewrite"
      },
      {
        id: "xpost-2",
        slot: 2,
        time: "09:40",
        format: "contrarian",
        topic: "cost of code",
        text: "Second punchy line",
        threadsVariant: "Second warmer rewrite"
      }
    ],
    replies: [],
    createdAt: "2026-07-22T06:00:00.000Z",
    ...overrides
  };
}

const beforeTheDay = new Date("2026-07-22T06:00:00.000Z");

describe("planBatch", () => {
  it("gives each account its own version of every slot", () => {
    const { items } = planBatch({ pack: pack(), config: config(), now: beforeTheDay });

    expect(items).toHaveLength(4);
    expect(items.filter((item) => item.accountId === "primary").map((item) => item.text)).toEqual([
      "The punchy line",
      "Second punchy line"
    ]);
    expect(items.filter((item) => item.accountId === "secondary").map((item) => item.text)).toEqual([
      "The warmer rewrite",
      "Second warmer rewrite"
    ]);
  });

  it("never gives two accounts the same text", () => {
    const { items } = planBatch({ pack: pack(), config: config(), now: beforeTheDay });
    for (const slot of [1, 2]) {
      const texts = items.filter((item) => item.slot === slot).map((item) => item.text);
      expect(new Set(texts).size).toBe(texts.length);
    }
  });

  it("puts each account at the slot's wall-clock time plus its own offset", () => {
    const { items } = planBatch({ pack: pack(), config: config(), now: beforeTheDay });
    const first = items.filter((item) => item.slot === 1);

    expect(first.find((item) => item.accountId === "primary")?.publishAt).toBe("2026-07-22T07:15:00.000Z");
    expect(first.find((item) => item.accountId === "secondary")?.publishAt).toBe("2026-07-22T07:18:00.000Z");
  });

  it("schedules only the connected account when just one is set up", () => {
    const { items } = planBatch({ pack: pack(), config: config({ accounts: [account()] }), now: beforeTheDay });

    expect(items).toHaveLength(2);
    expect(items.every((item) => item.accountId === "primary" && item.version === "text")).toBe(true);
  });

  it("lets an account be pointed at the other version", () => {
    const { items } = planBatch({
      pack: pack(),
      config: config({ accounts: [account({ posts: "variant" })] }),
      now: beforeTheDay
    });

    expect(items.map((item) => item.text)).toEqual(["The warmer rewrite", "Second warmer rewrite"]);
  });

  it("drops a past slot for every account at once, rather than backdating it", () => {
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

  it("keeps the accounts in step: a slot is scheduled for both or neither", () => {
    // 07:15 has passed but the secondary's +3 offset would still be in the
    // future — the slot must not be scheduled for one account only.
    const { items } = planBatch({
      pack: pack(),
      config: config(),
      now: new Date("2026-07-22T07:16:00.000Z")
    });

    expect(items.filter((item) => item.slot === 1)).toHaveLength(0);
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
      accountId: "primary",
      version: "text",
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
