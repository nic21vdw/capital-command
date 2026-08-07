import { beforeEach, describe, expect, it, vi } from "vitest";
import { sep } from "node:path";
import type { PipelineRun } from "@/lib/pipeline/types";

const state = {
  run: {} as PipelineRun,
  candidates: [] as { id: string; title: string; filePath: string }[],
  enqueued: [] as string[]
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
    clips: state.candidates.map((candidate) => ({ id: candidate.id, title: candidate.title, file: `${candidate.id}.mp4` }))
  }),
  outputDir: () => "C:/outputs/job1"
}));

vi.mock("@/lib/longform/store", () => ({ getProject: async () => undefined, projectOutputDir: () => "" }));
vi.mock("@/lib/publisher/config", () => ({
  publisherConfig: () => ({ enabled: true, platforms: ["youtube"], timezone: "America/Toronto" })
}));
vi.mock("@/lib/publisher/queue", () => ({ publishQueue: () => ({ list: async () => [] }) }));
vi.mock("@/lib/publisher/enqueue", () => ({
  enqueue: async ({ clipPath, publishAt }: { clipPath: string; publishAt: string }) => {
    state.enqueued.push(clipPath);
    return { publishAt, platforms: { youtube: {} } };
  }
}));

const { queueReadyOutputs, queueRunOutputs } = await import("@/lib/pipeline/queueOutputs");

beforeEach(() => {
  state.enqueued = [];
  state.candidates = [
    { id: "keep", title: "Keeper", filePath: "keep.mp4" },
    { id: "drop", title: "The one he unticked", filePath: "drop.mp4" }
  ];
  state.run = {
    id: "run1",
    name: "Day 30",
    status: "running",
    notices: [],
    clipJobId: "job1",
    queueWhenReady: true,
    createdAt: "now",
    updatedAt: "now"
  } as PipelineRun;
});

describe("what the standing instruction is allowed to book", () => {
  it("never books what he unticked, however many times it runs", async () => {
    const result = await queueRunOutputs("run1", ["clip:job1:keep"]);
    expect(result.queued.map((item) => item.title)).toEqual(["Keeper"]);
    expect(state.run.queueHeldBack).toContain("clip:job1:drop");

    state.enqueued = [];
    await queueReadyOutputs();
    // The old behaviour re-planned from scratch and booked the unticked clip
    // ninety seconds after he unticked it.
    expect(state.enqueued).toEqual([]);
  });

  it("does not re-book something he deleted from the queue afterwards", async () => {
    await queueRunOutputs("run1", ["clip:job1:keep"]);
    expect(state.run.queueBooked).toContain("clip:job1:keep");
    state.enqueued = [];
    // The queue is empty again — as it would be if he deleted the item — and the
    // file is still on disk, so path dedupe alone would book it a second time.
    await queueReadyOutputs();
    expect(state.enqueued).toEqual([]);
  });

  it("books an output that only appeared after he confirmed", async () => {
    await queueRunOutputs("run1", ["clip:job1:keep"]);
    state.enqueued = [];
    state.candidates.push({ id: "late", title: "Rendered later", filePath: "late.mp4" });
    await queueReadyOutputs();
    expect(state.enqueued.map((path) => path.split(sep).join("/"))).toEqual(["C:/outputs/job1/late.mp4"]);
  });
});

describe("what the sheet says about a decision he already made", () => {
  it("lists a held-back output unticked, and books it when he ticks it", async () => {
    await queueRunOutputs("run1", ["clip:job1:keep"]);
    expect(state.run.queueHeldBack).toContain("clip:job1:drop");

    // The plan still SHOWS it — offering nothing at all is how the sheet ended
    // up listing an output it would then refuse to book.
    const { planRunOutputs } = await import("@/lib/pipeline/queueOutputs");
    const plan = await planRunOutputs("run1");
    const dropped = plan?.candidates.find((item) => item.id === "clip:job1:drop");
    expect(dropped?.heldBack).toBe("unticked");

    state.enqueued = [];
    const booked = await queueRunOutputs("run1", ["clip:job1:drop"]);
    expect(booked.queued.map((item) => item.title)).toEqual(["The one he unticked"]);
    expect(state.run.queueHeldBack).not.toContain("clip:job1:drop");
  });

  it("marks one that was booked and has since left the queue", async () => {
    await queueRunOutputs("run1", ["clip:job1:keep"]);
    const { planRunOutputs } = await import("@/lib/pipeline/queueOutputs");
    const plan = await planRunOutputs("run1");
    expect(plan?.candidates.find((item) => item.id === "clip:job1:keep")?.heldBack).toBe("removed");
  });
});
