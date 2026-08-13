import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineRun } from "@/lib/pipeline/types";

/**
 * The Shorts length rule belongs to Shorts. A run's long-form edit is booked as
 * a full-length YouTube upload and must reach the queue however long it is —
 * every one of them used to come back "trim it below 3 minutes" — while a clip
 * posted as a Short over the limit is still refused.
 */

const OUTPUT_DIR = path.join(os.tmpdir(), `queue-longform-${process.pid}-${Math.random().toString(36).slice(2)}`);
const LONG_SECONDS = 352;

const state = {
  run: {} as PipelineRun,
  clips: [] as { id: string; title: string }[],
  added: [] as { title?: string; clipPath: string }[],
  config: { enabled: true, platforms: ["youtube"], timezone: "America/Toronto", defaultVisibility: "public" }
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
  outputDir: () => OUTPUT_DIR
}));

vi.mock("@/lib/longform/store", () => ({
  getProject: async () => ({
    id: "proj1",
    exports: [{ id: "export1", status: "done", file: "longform.mp4", title: "Day 10: Yapping Until I Can Buy a Nicer Car" }],
    topics: []
  }),
  projectOutputDir: () => OUTPUT_DIR
}));

vi.mock("@/lib/publisher/config", () => ({
  publisherConfig: () => state.config,
  configuredPlatforms: () => state.config.platforms,
  hostingConfigured: () => false
}));

vi.mock("@/lib/publisher/queue", () => ({
  publishQueue: () => ({
    list: async () => [],
    add: async (item: { title?: string; clipPath: string }) => {
      state.added.push(item);
    }
  }),
  newPlatformState: () => ({ status: "pending", attempts: 0 })
}));

vi.mock("@/lib/clipping/ffmpeg", () => ({
  probeVideoStream: vi.fn(async () => ({ width: 1920, height: 1080, durationSec: LONG_SECONDS })),
  hasAudioStream: vi.fn(async () => true)
}));

vi.mock("@/lib/clipping/render", () => ({ renderVertical: vi.fn() }));

vi.mock("@/lib/publisher/metadata", () => ({
  generateClipMetadata: async () => ({ title: "Generated", description: "", hashtags: ["#ai"] })
}));

const { queueRunOutputs } = await import("@/lib/pipeline/queueOutputs");

beforeEach(async () => {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, "longform.mp4"), Buffer.alloc(64, 1));
  await writeFile(path.join(OUTPUT_DIR, "clip1.mp4"), Buffer.alloc(64, 1));
  state.added = [];
  state.clips = [];
  state.run = {
    id: "run1",
    name: "Day 10: Yapping Until I Can Buy a Nicer Car",
    status: "running",
    clipJobId: "job1",
    longformProjectId: "proj1",
    longformExportId: "export1"
  } as PipelineRun;
});

describe("booking a run's long-form edit", () => {
  it("books an export far longer than three minutes", async () => {
    const result = await queueRunOutputs("run1");

    expect(result.failed).toEqual([]);
    expect(result.queued.map((item) => item.title)).toEqual([
      "Day 10: Yapping Until I Can Buy a Nicer Car"
    ]);
    // Posted exactly as it was rendered — no 9:16 re-render. The probe still
    // runs, but only to confirm the file holds a video at all; its 352 seconds
    // and its 16:9 shape are read and ignored.
    expect(state.added[0].clipPath.endsWith("longform.mp4")).toBe(true);
    expect(state.added[0].clipPath.endsWith("-vertical.mp4")).toBe(false);
  });

  it("still refuses a Short over the length limit", async () => {
    state.clips = [{ id: "clip1", title: "A clip that ran long" }];

    const result = await queueRunOutputs("run1");

    expect(result.queued.map((item) => item.title)).toEqual([
      "Day 10: Yapping Until I Can Buy a Nicer Car"
    ]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].title).toBe("A clip that ran long");
    expect(result.failed[0].error).toMatch(/3 minutes/);
  });
});
