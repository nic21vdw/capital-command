import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LongformProject } from "@/lib/longform/types";
import type { PipelineRun } from "@/lib/pipeline/types";

const state = {
  run: {} as PipelineRun,
  project: {} as LongformProject,
  rendering: new Set<string>(),
  started: [] as string[],
  advanced: 0
};

vi.mock("@/lib/pipeline/runs", () => ({
  getRun: async (id: string) => (id === state.run.id ? state.run : undefined),
  runOverview: async () => ({ stages: {}, schedulable: {}, settled: false }),
  advanceRun: async () => {
    state.advanced += 1;
  },
  updateRun: async (run: PipelineRun, patch: Partial<PipelineRun>) => {
    Object.assign(run, patch);
  }
}));

vi.mock("@/lib/longform/store", () => ({
  getProject: async (id: string) => (id === state.project.id ? state.project : undefined),
  updateProject: async (id: string, patch: Partial<LongformProject>) => {
    if (id === state.project.id) Object.assign(state.project, patch);
    return state.project;
  }
}));

vi.mock("@/lib/longform/render", () => ({
  isExportRendering: (recordId: string) => state.rendering.has(recordId),
  startLongformExport: async () => {
    const id = `fresh-${state.started.length + 1}`;
    state.started.push(id);
    state.project.exports = [{ id, status: "processing", progress: 1, createdAt: "now" }, ...state.project.exports];
    return state.project.exports[0];
  }
}));

vi.mock("@/lib/clipping/jobs", () => ({ retryMissingRenders: async () => undefined }));

const { repairRun } = await import("@/lib/pipeline/repair");

beforeEach(() => {
  state.rendering = new Set();
  state.started = [];
  state.advanced = 0;
  state.run = {
    id: "run1",
    name: "Day 28",
    status: "running",
    notices: [],
    longformProjectId: "proj1",
    longformExportId: "dead",
    audioNote: "The podcast MP3 could not be cut from the edited video.",
    createdAt: "now",
    updatedAt: "now"
  } as PipelineRun;
  state.project = {
    id: "proj1",
    status: "ready",
    exports: [{ id: "dead", status: "processing", progress: 40, createdAt: "then" }]
  } as LongformProject;
});

describe("retrying a long-form export", () => {
  it("retires the record a restart stranded and renders a fresh one", async () => {
    const result = await repairRun("run1", "longform");
    expect(result.ok).toBe(true);
    expect(state.project.exports.find((record) => record.id === "dead")?.status).toBe("canceled");
    expect(state.run.longformExportId).toBe(state.started[0]);
    // The MP3 is cut from whatever the export produced, so its "gave up" marker
    // has to go with the dead render or the podcast never comes back.
    expect(state.run.audioNote).toBeUndefined();
    expect(state.advanced).toBe(1);
  });

  it("leaves an export that really is rendering alone", async () => {
    state.rendering.add("dead");
    const result = await repairRun("run1", "longform");
    expect(result).toMatchObject({ ok: false });
    expect(state.started).toEqual([]);
    expect(state.project.exports[0].status).toBe("processing");
  });

  it("says so when the analysis itself is what failed", async () => {
    state.project.status = "error";
    expect(await repairRun("run1", "longform")).toMatchObject({ ok: false });
    expect(state.started).toEqual([]);
  });
});
