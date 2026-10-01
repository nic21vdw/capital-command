import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isAutomationPaused,
  recordAutomationOutcome,
} from "@/lib/automations/store";
import {
  advancePipelineOnce,
  startPipelineHeartbeat,
} from "@/lib/pipeline/heartbeat";
import { listRuns, runOverview } from "@/lib/pipeline/runs";
import { processDuePodcastDeliveries } from "@/lib/podcast/schedule";

vi.mock("@/lib/automations/store", () => ({
  isAutomationPaused: vi.fn(async () => false),
  recordAutomationOutcome: vi.fn(async () => undefined),
}));
vi.mock("@/lib/pipeline/runs", () => ({
  listRuns: vi.fn(async () => []),
  runOverview: vi.fn(),
  overviewContext: () => ({}),
}));
vi.mock("@/lib/podcast/schedule", () => ({
  processDuePodcastDeliveries: vi.fn(async () => 0),
}));
vi.mock("@/lib/music/jobs", () => ({
  listMusicJobs: async () => [],
  advanceMusicJob: vi.fn(),
}));
vi.mock("@/lib/pipeline/queueOutputs", () => ({
  queueReadyOutputs: async () => undefined,
  stopQueueingWhenSettled: async () => undefined,
  recordQueueFailure: vi.fn(),
}));
vi.mock("@/lib/pipeline/queuePosts", () => ({ queueRunPosts: vi.fn() }));

const runtime = globalThis as typeof globalThis & {
  __pipelineHeartbeat?: NodeJS.Timeout;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(listRuns).mockResolvedValue([]);
  vi.mocked(isAutomationPaused).mockResolvedValue(false);
  delete runtime.__pipelineHeartbeat;
});

afterEach(() => {
  vi.clearAllTimers();
  delete runtime.__pipelineHeartbeat;
  vi.useRealTimers();
});

describe("pipeline and podcast heartbeat", () => {
  it("drains due podcasts even with zero live pipeline runs", async () => {
    startPipelineHeartbeat();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(processDuePodcastDeliveries).toHaveBeenCalledTimes(1);
    expect(recordAutomationOutcome).toHaveBeenCalledWith(
      "pipeline",
      expect.objectContaining({
        status: "completed",
        detail: "Checked 0 pipeline runs.",
      }),
    );
  });

  it("keeps podcast drainage independent of a paused pipeline", async () => {
    vi.mocked(isAutomationPaused).mockResolvedValue(true);
    startPipelineHeartbeat();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(listRuns).not.toHaveBeenCalled();
    expect(processDuePodcastDeliveries).toHaveBeenCalledTimes(1);
    expect(recordAutomationOutcome).toHaveBeenCalledWith(
      "pipeline",
      expect.objectContaining({ status: "paused" }),
    );
  });

  it("records a failure when a run throws rather than reporting a healthy tick", async () => {
    vi.mocked(listRuns).mockResolvedValue([
      { id: "run-1", name: "Real stream", status: "running" },
    ] as never);
    vi.mocked(runOverview).mockRejectedValue(new Error("Source missing"));
    startPipelineHeartbeat();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(recordAutomationOutcome).toHaveBeenCalledWith(
      "pipeline",
      expect.objectContaining({
        status: "failed",
        detail: "Real stream: Source missing",
      }),
    );
  });

  it("reports broken stages while still checking the rest of the runs", async () => {
    vi.mocked(listRuns).mockResolvedValue([
      { id: "run-1", name: "Real stream", status: "running" },
      { id: "run-2", name: "Other stream", status: "running" },
    ] as never);
    vi.mocked(runOverview)
      .mockResolvedValueOnce({
        stages: { podcast: { status: "error" } },
      } as never)
      .mockResolvedValueOnce({ stages: {} } as never);
    await expect(advancePipelineOnce()).rejects.toThrow(
      "podcast need attention",
    );
    expect(runOverview).toHaveBeenCalledTimes(2);
  });
});
