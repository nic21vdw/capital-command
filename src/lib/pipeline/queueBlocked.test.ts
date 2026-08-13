import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUBLISHING_OFF_MESSAGE } from "@/lib/publisher/enabledMessage";
import type { PipelineRun } from "@/lib/pipeline/types";

const state = {
  run: {} as PipelineRun,
  clips: [] as { id: string; title: string }[],
  /** Titles the publish queue refuses, so one output can fail while others book. */
  refuse: [] as string[],
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
  enqueue: async ({ publishAt, title }: { publishAt: string; title: string }) => {
    if (state.refuse.includes(title)) throw new Error("The hosting bucket refused it.");
    return { publishAt, platforms: { youtube: {} } };
  }
}));

const { dismissQueueFailures, queueReadyOutputs } = await import("@/lib/pipeline/queueOutputs");

const publishingOff = { enabled: false, platforms: [], timezone: "America/Toronto" };
const publishingOn = { enabled: true, platforms: ["youtube"], timezone: "America/Toronto" };

beforeEach(() => {
  state.config = { ...publishingOn };
  state.clips = [{ id: "keep", title: "Keeper" }];
  state.refuse = [];
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

describe("a failure that has been dealt with", () => {
  it("goes as soon as a drain gets past the block", async () => {
    state.config = { ...publishingOff };
    await queueReadyOutputs();
    expect(state.run.queueFailures).toHaveLength(1);

    state.config = { ...publishingOn };
    await queueReadyOutputs();
    expect(state.run.queueFailures).toBeUndefined();
  });

  it("goes for the output that booked, and stays for the one that did not", async () => {
    state.clips = [
      { id: "keep", title: "Keeper" },
      { id: "bad", title: "Bad" }
    ];
    state.refuse = ["Keeper", "Bad"];
    await queueReadyOutputs();
    expect(state.run.queueFailures?.map((item) => item.title).sort()).toEqual(["Bad", "Keeper"]);

    state.refuse = ["Bad"];
    await queueReadyOutputs();
    expect(state.run.queueFailures?.map((item) => item.title)).toEqual(["Bad"]);

    state.refuse = [];
    await queueReadyOutputs();
    expect(state.run.queueFailures).toBeUndefined();
  });

  it("does not clear a complaint about something this drain never touched", async () => {
    state.clips = [{ id: "bad", title: "Bad" }];
    state.refuse = ["Bad"];
    await queueReadyOutputs();
    // Nothing is left waiting now, so the next drain books nothing at all — the
    // complaint about Bad must survive that.
    state.run.queueHeldBack = ["clip:job1:bad"];
    await queueReadyOutputs();
    expect(state.run.queueFailures?.map((item) => item.title)).toEqual(["Bad"]);
  });
});

describe("a failure he has decided to live with", () => {
  it("is dismissed and does not come back on the next drain", async () => {
    state.config = { ...publishingOff };
    await queueReadyOutputs();
    expect(await dismissQueueFailures(state.run.id)).toBe(true);
    expect(state.run.queueFailures).toBeUndefined();

    state.config = { ...publishingOn };
    await queueReadyOutputs();
    expect(state.run.queueFailures).toBeUndefined();
  });

  it("comes back if it happens again", async () => {
    state.config = { ...publishingOff };
    await queueReadyOutputs();
    await dismissQueueFailures(state.run.id);
    await queueReadyOutputs();
    expect(state.run.queueFailures).toHaveLength(1);
  });

  it("says so when there was nothing to dismiss", async () => {
    expect(await dismissQueueFailures(state.run.id)).toBe(false);
  });
});
