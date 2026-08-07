import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUBLISHING_OFF_MESSAGE } from "@/lib/publisher/enabledMessage";
import type { PipelineRun } from "@/lib/pipeline/types";

const state = {
  run: {} as PipelineRun,
  clips: [] as { id: string; title: string }[],
  config: { enabled: true, platforms: ["youtube"], timezone: "America/Toronto" } as {
    enabled: boolean;
    platforms: string[];
    timezone: string;
  }
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
vi.mock("@/lib/publisher/queue", () => ({ publishQueue: () => ({ list: async () => [] }) }));
vi.mock("@/lib/publisher/enqueue", () => ({
  enqueue: async ({ publishAt }: { publishAt: string }) => ({ publishAt, platforms: { youtube: {} } })
}));

const { queueReadyOutputs } = await import("@/lib/pipeline/queueOutputs");

beforeEach(() => {
  state.config = { enabled: true, platforms: ["youtube"], timezone: "America/Toronto" };
  state.clips = [{ id: "keep", title: "Keeper" }];
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

describe("a run that could book nothing at all", () => {
  it("records the block against the whole run when publishing is off", async () => {
    state.config = { enabled: false, platforms: [], timezone: "America/Toronto" };
    await queueReadyOutputs();
    expect(state.run.queueFailures).toEqual([{ title: "Everything", error: PUBLISHING_OFF_MESSAGE }]);
  });

  it("records the block when nothing has a platform to go to", async () => {
    state.config = { enabled: true, platforms: [], timezone: "America/Toronto" };
    await queueReadyOutputs();
    expect(state.run.queueFailures?.[0].title).toBe("Everything");
    expect(state.run.queueFailures?.[0].error).toContain("No platforms are switched on");
  });

  it("says nothing when there is simply nothing left waiting", async () => {
    state.clips = [];
    await queueReadyOutputs();
    expect(state.run.queueFailures).toBeUndefined();
  });

  it("does not repeat itself every tick", async () => {
    state.config = { enabled: false, platforms: [], timezone: "America/Toronto" };
    await queueReadyOutputs();
    await queueReadyOutputs();
    expect(state.run.queueFailures).toHaveLength(1);
  });
});
