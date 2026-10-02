import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineRun } from "@/lib/pipeline/types";
import { queueRunPosts } from "@/lib/pipeline/queuePosts";
import { readQueue, writeQueue } from "@/lib/threads/queue";

const mocks = vi.hoisted(() => ({ getRun: vi.fn(), updateRun: vi.fn() }));
vi.mock("@/lib/pipeline/runs", () => mocks);

const run: PipelineRun = {
  id: "stream-run", name: "A real stream", status: "running", notices: [],
  posts: [{ id: "post-a", platform: "threads", text: "Build a small tool for a task you repeat." },
    { id: "post-b", platform: "threads", text: "Keeping agent context nearby helps when a task changes." }],
  createdAt: "2026-10-02T15:00:00Z", updatedAt: "2026-10-02T15:00:00Z"
};

beforeEach(async () => {
  await writeQueue([]);
  mocks.getRun.mockReset().mockImplementation(async () => structuredClone(run));
  mocks.updateRun.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("THREADS_ACCESS_TOKEN", "test-token");
});

describe("pipeline Threads scheduling handoff", () => {
  it("books a run once when two automation callers start together", async () => {
    const results = await Promise.all([queueRunPosts(run.id), queueRunPosts(run.id)]);
    const items = await readQueue();
    expect(items).toHaveLength(2);
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
    expect(items.every((item) => item.sourceRunId === run.id && item.origin === "pipeline")).toBe(true);
    expect(results.map((result) => result.firstAt)).toEqual([items[0].publishAt, items[0].publishAt]);
  });

  it("recovers the durable booking after saving the run marker fails", async () => {
    mocks.updateRun.mockRejectedValueOnce(new Error("run marker disk failure"));
    await expect(queueRunPosts(run.id)).rejects.toThrow("run marker disk failure");
    const first = await readQueue();
    const recovered = await queueRunPosts(run.id);
    expect(await readQueue()).toEqual(first);
    expect(recovered).toMatchObject({ scheduled: 2, firstAt: first[0].publishAt });
    expect(mocks.updateRun).toHaveBeenCalledTimes(2);
  });
});
