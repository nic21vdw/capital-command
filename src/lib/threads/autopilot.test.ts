import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadsQueueItem } from "@/lib/threads/types";

/**
 * The two halves that make the loop actually deliver a full day unattended:
 * writing tomorrow's batch tonight (a round-the-clock day whose first slot is
 * 00:20 has to exist before midnight), and re-laying a day that fell behind
 * while the machine was off.
 */

const store: { items: ThreadsQueueItem[] } = { items: [] };

vi.mock("@/lib/threads/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/threads/queue")>();
  return {
    ...actual,
    readQueue: async () => store.items,
    writeQueue: async (items: ThreadsQueueItem[]) => {
      store.items = items;
    },
    mutateQueue: async <T>(change: (items: ThreadsQueueItem[]) => { items: ThreadsQueueItem[]; result: T }) => {
      const { items, result } = change(store.items);
      store.items = items;
      return result;
    }
  };
});

const state: { value: Record<string, string> } = { value: {} };

vi.mock("@/lib/threads/state", () => ({
  readThreadsState: async () => state.value,
  recordThreadsState: async (patch: Record<string, string>) => {
    state.value = { ...state.value, ...patch };
  }
}));

const ensureDailyPack = vi.fn(async (options: { date?: string } = {}) => ({
  pack: pack(options.date ?? localKey(new Date())),
  cached: false,
  reason: null
}));

vi.mock("@/lib/x-posts/daily", () => ({
  ensureDailyPack: (options: { date?: string } = {}) => ensureDailyPack(options)
}));

const POSTS_PER_DAY = 24;

function localKey(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** A given wall-clock time today, in the machine's own zone. */
function localAt(hour: number, minute = 0): Date {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date;
}

/** A full day's pack, one slot an hour round the clock. */
function pack(date: string) {
  return {
    id: `xpack-${date}`,
    date,
    source: "ai" as const,
    posts: Array.from({ length: POSTS_PER_DAY }, (_, index) => ({
      id: `xpost-${index + 1}`,
      slot: index + 1,
      time: `${String(index).padStart(2, "0")}:20`,
      format: "insight" as const,
      topic: `topic ${index + 1}`,
      text: `punchy ${index + 1}`,
      threadsVariant: `warm ${index + 1}`
    })),
    replies: [],
    createdAt: new Date().toISOString()
  };
}

/** One day's queue, with only `published` slots left standing. */
function dayWith(date: string, published: number[]): ThreadsQueueItem[] {
  return Array.from({ length: POSTS_PER_DAY }, (_, index) => {
    const slot = index + 1;
    return {
      id: `item-${slot}`,
      batchDate: date,
      slot,
      accountId: "primary",
      version: "variant" as const,
      topic: `topic ${slot}`,
      format: "insight",
      text: `warm ${slot}`,
      publishAt: localAt(index, 20).toISOString(),
      status: published.includes(slot) ? ("published" as const) : ("skipped" as const),
      attempts: 0,
      createdAt: new Date().toISOString()
    };
  });
}

beforeEach(() => {
  store.items = [];
  state.value = {};
  ensureDailyPack.mockClear();
  process.env.THREADS_ACCESS_TOKEN = "token-1";
  process.env.THREADS_POSTS_PER_DAY = String(POSTS_PER_DAY);
  // The batch date is the machine's local day, so the slot times have to be
  // read in the machine's own zone or a synthetic instant lands on the wrong one.
  process.env.THREADS_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
});

afterEach(() => {
  delete process.env.THREADS_ACCESS_TOKEN;
  delete process.env.THREADS_POSTS_PER_DAY;
  delete process.env.THREADS_TIMEZONE;
  delete process.env.THREADS_PLAN_AHEAD_HOUR;
  delete process.env.THREADS_CATCHUP;
});

describe("planTomorrow", () => {
  it("writes the whole of tomorrow once the evening comes round", async () => {
    const { planTomorrow, nextDateKey } = await import("@/lib/threads/daily");
    const { threadsConfig } = await import("@/lib/threads/config");
    const now = localAt(21, 30);

    const result = await planTomorrow({ now, log: () => {} });

    const tomorrow = nextDateKey(now, threadsConfig());
    expect(result?.date).toBe(tomorrow);
    // Every slot survives: none of tomorrow has happened yet, which is the
    // whole reason for planning it tonight.
    expect(result?.created).toBe(POSTS_PER_DAY);
    expect(result?.droppedPastSlots).toBe(0);
    expect(store.items.every((item) => item.batchDate === tomorrow)).toBe(true);
  });

  it("leaves tomorrow alone before the cutoff", async () => {
    const { planTomorrow } = await import("@/lib/threads/daily");

    expect(await planTomorrow({ now: localAt(9), log: () => {} })).toBeNull();
    expect(store.items).toHaveLength(0);
    expect(ensureDailyPack).not.toHaveBeenCalled();
  });

  it("pays for tomorrow's pack once, however many evening ticks run", async () => {
    const { planTomorrow } = await import("@/lib/threads/daily");
    await planTomorrow({ now: localAt(21, 30), log: () => {} });
    const created = store.items.length;

    const second = await planTomorrow({ now: localAt(21, 35), log: () => {} });

    expect(second).toBeNull();
    expect(ensureDailyPack).toHaveBeenCalledTimes(1);
    expect(store.items).toHaveLength(created);
  });
});

describe("catchUpToday", () => {
  it("re-lays a day that was missed, without crowding the feed", async () => {
    const { catchUpToday } = await import("@/lib/threads/daily");
    const now = localAt(18);
    const today = localKey(now);
    store.items = dayWith(today, [1, 2]);

    const result = await catchUpToday({ now, log: () => {} });

    expect(result?.created).toBeGreaterThan(0);
    const pending = store.items
      .filter((item) => item.status === "pending")
      .map((item) => new Date(item.publishAt).getTime())
      .sort((a, b) => a - b);
    expect(pending.length).toBe(result?.created);
    // Nothing before now, nothing tighter than the catch-up gap, nothing past
    // midnight into tomorrow's batch.
    expect(pending[0]).toBeGreaterThan(now.getTime());
    const gaps = pending.slice(1).map((time, index) => (time - pending[index]) / 60_000);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(20);
    expect(new Date(pending[pending.length - 1]).getDate()).toBe(now.getDate());
    // The two that already went out keep their place in history and are not
    // put back through the feed.
    expect(store.items.filter((item) => item.status === "published").map((item) => item.slot)).toEqual([1, 2]);
    const relaidSlots = store.items.filter((item) => item.status === "pending").map((item) => item.slot);
    expect(relaidSlots).not.toContain(1);
    expect(relaidSlots).not.toContain(2);
  });

  it("leaves a day that is running to plan alone", async () => {
    const { catchUpToday } = await import("@/lib/threads/daily");
    const now = localAt(9);
    const today = localKey(now);
    // Everything ahead of now is still pending — the day is intact.
    store.items = dayWith(today, []).map((item, index) => ({
      ...item,
      status: index < 9 ? ("published" as const) : ("pending" as const)
    }));

    expect(await catchUpToday({ now, log: () => {} })).toBeNull();
  });

  it("does not touch a day it has not planned yet", async () => {
    const { catchUpToday } = await import("@/lib/threads/daily");

    expect(await catchUpToday({ now: localAt(9), log: () => {} })).toBeNull();
    expect(ensureDailyPack).not.toHaveBeenCalled();
  });

  it("re-lays at most once a cooldown, so a full day cannot churn its own queue", async () => {
    const { catchUpToday } = await import("@/lib/threads/daily");
    const now = localAt(18);
    store.items = dayWith(localKey(now), [1, 2]);
    await catchUpToday({ now, log: () => {} });

    const second = await catchUpToday({ now: localAt(18, 20), log: () => {} });

    expect(second).toBeNull();
  });

  it("stays out of the way when switched off", async () => {
    process.env.THREADS_CATCHUP = "false";
    const { catchUpToday } = await import("@/lib/threads/daily");
    const now = localAt(18);
    store.items = dayWith(localKey(now), [1, 2]);

    expect(await catchUpToday({ now, log: () => {} })).toBeNull();
  });
});
