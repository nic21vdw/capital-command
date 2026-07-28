import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadsQueueItem } from "@/lib/threads/types";

/**
 * The plan step is two separate read-modify-writes with minutes of model time
 * between them — long enough for the next scheduled tick to start, see an empty
 * day, and plan it as well. That put two posts on every slot of a day at
 * identical times, which is exactly the burst the whole design avoids.
 */

/** The queue file, held in memory. The pure helpers stay real. */
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

/** Blocks pack generation on demand, so a second plan can start mid-flight. */
let holdPack: Promise<void> | null = null;
const ensureDailyPack = vi.fn(async () => {
  if (holdPack) await holdPack;
  return { pack: pack(), cached: false, reason: null };
});

vi.mock("@/lib/x-posts/daily", () => ({ ensureDailyPack: () => ensureDailyPack() }));

function todayKey(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function pack() {
  return {
    id: "xpack-1",
    date: todayKey(),
    source: "ai" as const,
    // Late enough in the day that the slot is still in the future whenever
    // this runs — a past slot is dropped, which would mask the race.
    posts: [
      {
        id: "xpost-1",
        slot: 1,
        time: "23:59",
        format: "insight" as const,
        topic: "verification",
        text: "punchy",
        threadsVariant: "warm"
      }
    ],
    replies: [],
    createdAt: new Date().toISOString()
  };
}

beforeEach(() => {
  store.items = [];
  holdPack = null;
  ensureDailyPack.mockClear();
  process.env.THREADS_ACCESS_TOKEN = "token-1";
  process.env.THREADS_TIMEZONE = "UTC";
});

afterEach(() => {
  delete process.env.THREADS_ACCESS_TOKEN;
  delete process.env.THREADS_TIMEZONE;
});

/**
 * Real "now". The batch date comes from the machine's local calendar, so a
 * synthetic UTC instant can land on the previous local day and never match the
 * batch it is looking for.
 */
function nowish(): Date {
  return new Date();
}

describe("planTodaysBatch", () => {
  it("plans the day once", async () => {
    const { planTodaysBatch } = await import("@/lib/threads/daily");

    const result = await planTodaysBatch({ now: nowish(), log: () => {} });

    expect(result.created).toBe(1);
    expect(store.items).toHaveLength(1);
  });

  it("does nothing when the day is already planned", async () => {
    const { planTodaysBatch } = await import("@/lib/threads/daily");
    await planTodaysBatch({ now: nowish(), log: () => {} });

    const second = await planTodaysBatch({ now: nowish(), log: () => {} });

    expect(second.created).toBe(0);
    expect(second.skipped).toContain("already scheduled");
    expect(store.items).toHaveLength(1);
  });

  it("does not double the day when two ticks overlap mid-generation", async () => {
    const { planTodaysBatch } = await import("@/lib/threads/daily");

    // First tick reaches the model and stalls there.
    let release = () => {};
    holdPack = new Promise<void>((resolve) => (release = resolve));
    const first = planTodaysBatch({ now: nowish(), log: () => {} });
    await vi.waitFor(() => expect(ensureDailyPack).toHaveBeenCalledTimes(1));

    // A second tick runs start to finish while the first is still waiting.
    holdPack = null;
    const second = await planTodaysBatch({ now: nowish(), log: () => {} });
    expect(second.created).toBe(1);

    // Now let the first finish: its batch must be discarded, not appended.
    release();
    const firstResult = await first;

    expect(firstResult.created).toBe(0);
    expect(firstResult.skipped).toContain("Another tick");
    expect(store.items).toHaveLength(1);
    expect(store.items.filter((item) => item.slot === 1)).toHaveLength(1);
  });
});
