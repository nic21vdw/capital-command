import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateSlots } from "@/lib/publisher/slots";
import type { PipelineRun } from "@/lib/pipeline/types";

const state = {
  run: {} as PipelineRun,
  clips: [] as { id: string; title: string }[],
  booked: [] as { publishAt: string }[],
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
vi.mock("@/lib/publisher/queue", () => ({ publishQueue: () => ({ list: async () => state.booked }) }));
vi.mock("@/lib/publisher/enqueue", () => ({
  enqueue: async ({ publishAt }: { publishAt: string }) => ({ publishAt, platforms: { youtube: {} } }),
  enqueueImagePost: async ({ publishAt }: { publishAt: string }) => ({ publishAt, platforms: { youtube: {} } })
}));

const { queueRunOutputs } = await import("@/lib/pipeline/queueOutputs");

/** Every slot the booker can reach, in the order it would fill them. */
function horizon(): string[] {
  return generateSlots({ timeZone: state.config.timezone, days: 120 })
    .filter((slot) => slot.bookable)
    .map((slot) => slot.utc);
}

/** The three weeks that used to be the whole calendar. */
function firstThreeWeeks(): string[] {
  return generateSlots({ timeZone: state.config.timezone, days: 21 })
    .filter((slot) => slot.bookable)
    .map((slot) => slot.utc);
}

beforeEach(() => {
  state.config = { enabled: true, platforms: ["youtube"], timezone: "America/Toronto" };
  state.booked = [];
  state.clips = Array.from({ length: 5 }, (_, i) => ({ id: `clip${i}`, title: `Clip ${i}` }));
  state.run = {
    id: "run1",
    name: "Day 30",
    status: "running",
    notices: [],
    clipJobId: "job1",
    createdAt: "now",
    updatedAt: "now"
  } as PipelineRun;
});

describe("booking when the calendar is already full", () => {
  it("refuses the overflow instead of stacking it onto slots that are taken", async () => {
    state.booked = horizon().map((publishAt) => ({ publishAt }));

    const result = await queueRunOutputs("run1");

    expect(result.queued).toHaveLength(0);
    expect(result.failed).toHaveLength(5);
    expect(result.failed[0].error).toContain("four months");
  });

  it("reaches past the booked three weeks instead of refusing the whole run", async () => {
    state.booked = firstThreeWeeks().map((publishAt) => ({ publishAt }));

    const result = await queueRunOutputs("run1");

    expect(result.queued).toHaveLength(5);
    expect(result.failed).toHaveLength(0);
    const taken = new Set(firstThreeWeeks());
    expect(result.queued.every((item) => !taken.has(item.publishAt))).toBe(true);
  });

  it("books only what actually fits, one output per free slot", async () => {
    const slots = horizon();
    const free = new Set([slots[3], slots[7]]);
    state.booked = slots.filter((slot) => !free.has(slot)).map((publishAt) => ({ publishAt }));

    const result = await queueRunOutputs("run1");

    expect(result.queued).toHaveLength(2);
    expect(result.failed).toHaveLength(3);
    const times = result.queued.map((item) => item.publishAt);
    expect(new Set(times).size).toBe(times.length);
    expect(times.every((time) => free.has(time))).toBe(true);
  });

  it("never puts two outputs on the same slot when the calendar is empty", async () => {
    const result = await queueRunOutputs("run1");

    expect(result.queued).toHaveLength(5);
    const times = result.queued.map((item) => item.publishAt);
    expect(new Set(times).size).toBe(times.length);
  });
});
