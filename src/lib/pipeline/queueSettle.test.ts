import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateSlots } from "@/lib/publisher/slots";
import type { QueueItem } from "@/lib/publisher/types";
import type { PipelineRun } from "@/lib/pipeline/types";

/**
 * Booking a run's outputs INSERTS them. It does not re-deal the calendar.
 *
 * It used to: the settle step called `planScheduleShuffle`, whose `moveCost` is
 * 0, so displacing a post he had already read cost nothing. On the real queue
 * that moved 338 of 394 upcoming posts, one of them by 86 days, every time a
 * segment finished rendering. The planner is now the repair, and this is the
 * bound that says so — the real planner runs here, and `applyPublishTimes` is
 * the real thing writing to an in-memory queue rather than the no-op stub the
 * other booking tests use, because that stub is exactly why this shipped.
 */

const state = {
  run: {} as PipelineRun,
  clips: [] as { id: string; title: string }[],
  queue: [] as QueueItem[],
  config: { enabled: true, platforms: ["youtube"], timezone: "America/Toronto" }
};

vi.mock("@/lib/pipeline/runs", () => ({
  getRun: async (id: string) => (id === state.run.id ? state.run : undefined),
  listRuns: async () => [state.run],
  updateRun: async (run: PipelineRun, patch: Partial<PipelineRun>) => {
    Object.assign(run, patch);
  }
}));

vi.mock("@/lib/clipping/jobs", () => ({
  getJob: async () => ({
    id: "job1",
    clips: state.clips.map((clip) => ({ id: clip.id, title: clip.title, file: `${clip.id}.mp4` }))
  }),
  outputDir: () => "C:/outputs/job1"
}));

vi.mock("@/lib/longform/store", () => ({ getProject: async () => undefined, projectOutputDir: () => "" }));
vi.mock("@/lib/publisher/config", () => ({ publisherConfig: () => state.config }));

vi.mock("@/lib/publisher/queue", () => ({
  publishQueue: () => ({
    list: async () => state.queue,
    // The real one, near enough: it writes the times the planner asked for.
    applyPublishTimes: async (updates: Array<{ id: string; publishAt: string }>) => {
      let changed = 0;
      for (const update of updates) {
        const item = state.queue.find((entry) => entry.id === update.id);
        if (!item || item.publishAt === update.publishAt) continue;
        item.publishAt = update.publishAt;
        changed += 1;
      }
      return changed;
    }
  })
}));

vi.mock("@/lib/publisher/enqueue", () => ({
  enqueue: async ({ publishAt, title, jobId }: { publishAt: string; title: string; jobId?: string }) => {
    const item = {
      id: `new-${state.queue.length}`,
      clipPath: `clips/${title}.mp4`,
      title,
      publishAt,
      jobId: jobId ?? "job1",
      platforms: { youtube: { status: "pending", attempts: 0 } }
    } as unknown as QueueItem;
    state.queue.push(item);
    return item;
  },
  enqueueImagePost: async () => {
    throw new Error("not used");
  }
}));

const { queueRunOutputs } = await import("@/lib/pipeline/queueOutputs");

function futureSlots(count: number): string[] {
  return generateSlots({ timeZone: state.config.timezone, days: 120 })
    .filter((slot) => slot.bookable)
    .map((slot) => slot.utc)
    .slice(0, count);
}

/** A settled calendar: one post per instant, each from a different stream. */
function settledQueue(count: number): QueueItem[] {
  return futureSlots(count).map(
    (publishAt, index) =>
      ({
        id: `old${index}`,
        clipPath: `clips/old${index}.mp4`,
        title: `Already scheduled ${index}`,
        publishAt,
        jobId: `stream${index}`,
        platforms: { youtube: { status: "pending", attempts: 0 } }
      }) as unknown as QueueItem
  );
}

beforeEach(() => {
  state.config = { enabled: true, platforms: ["youtube"], timezone: "America/Toronto" };
  state.queue = settledQueue(60);
  state.clips = Array.from({ length: 3 }, (_, i) => ({ id: `clip${i}`, title: `Clip ${i}` }));
  state.run = {
    id: "run1",
    name: "Day 12",
    status: "running",
    clipJobId: "job1"
  } as PipelineRun;
});

describe("booking inserts into the calendar instead of re-dealing it", () => {
  it("disturbs at most a handful of the posts that were already there", async () => {
    const before = new Map(state.queue.map((item) => [item.id, item.publishAt]));

    const result = await queueRunOutputs("run1");
    expect(result.failed).toEqual([]);
    expect(result.queued).toHaveLength(3);

    const movedOld = state.queue.filter((item) => before.has(item.id) && before.get(item.id) !== item.publishAt);
    // Three bookings onto a settled calendar of sixty. A re-deal moved almost
    // every one of them; an insert only disturbs posts that are genuinely in the
    // way of separating the three new ones, so the bound is the size of the
    // booking and not the size of the calendar.
    expect(movedOld.length).toBeLessThanOrEqual(result.queued.length);
  });

  it("does not touch a calendar that needs nothing", async () => {
    // One clip, dropped onto a settled calendar next to a different stream:
    // there is nothing to fix, so nothing may move.
    state.clips = [{ id: "clip0", title: "Clip 0" }];
    const before = new Map(state.queue.map((item) => [item.id, item.publishAt]));

    await queueRunOutputs("run1");

    expect(state.queue.filter((item) => before.has(item.id) && before.get(item.id) !== item.publishAt)).toEqual([]);
  });

  it("still separates a stream that landed next to itself", async () => {
    // Two posts from ONE stream on consecutive instants, with somewhere to
    // swap to — the thing the settle step exists to undo.
    const slots = futureSlots(6);
    state.queue = slots.map(
      (publishAt, index) =>
        ({
          id: `old${index}`,
          clipPath: `clips/old${index}.mp4`,
          title: `Already scheduled ${index}`,
          publishAt,
          jobId: index < 2 ? "sameStream" : `stream${index}`,
          platforms: { youtube: { status: "pending", attempts: 0 } }
        }) as unknown as QueueItem
    );
    state.clips = [{ id: "clip0", title: "Clip 0" }];

    await queueRunOutputs("run1");

    const order = [...state.queue].sort((a, b) => a.publishAt.localeCompare(b.publishAt));
    const backToBack = order.filter((item, index) => index > 0 && item.jobId === order[index - 1].jobId);
    expect(backToBack).toEqual([]);
  });

  it("never moves a post onto an instant its platform already holds", async () => {
    await queueRunOutputs("run1");

    const seen = new Map<string, number>();
    for (const item of state.queue) {
      const key = `${item.publishAt}|youtube`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    expect([...seen.values()].filter((count) => count > 1)).toEqual([]);
  });
});
