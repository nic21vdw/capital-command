import { unlink } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { threadsConfig } from "@/lib/threads/config";
import { mergeQueueChanges, mutateQueue, queuePath, readQueue, writeQueue } from "@/lib/threads/queue";
import { runDue } from "@/lib/threads/runner";
import type { ThreadsQueueItem } from "@/lib/threads/types";

const post = vi.hoisted(() => vi.fn());
vi.mock("@/lib/threads/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/threads/api")>(), postToThreads: post
}));

const NOW = new Date("2026-10-03T12:00:00Z");
function item(id: string, publishAt = NOW.toISOString()): ThreadsQueueItem {
  return {
    id, batchDate: "2026-10-03", slot: 1, accountId: "primary", version: "text",
    topic: "queue", format: "insight", text: id, publishAt,
    status: "pending", attempts: 0, createdAt: "2026-10-02T12:00:00Z"
  };
}

beforeEach(async () => { post.mockReset(); await unlink(queuePath()).catch(() => undefined); });

describe("Threads runner saves while dashboard and pipeline change the queue", () => {
  it("keeps intervening edits/additions/deletes while recording a deferred upload's result", async () => {
    const future = "2026-10-03T18:00:00Z";
    await writeQueue([item("sending"), item("edited", future), item("removed", future)]);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    post.mockImplementation(async () => {
      await blocked;
      return { containerId: "container-one", postId: "post-one" };
    });
    const config = {
      ...threadsConfig(), enabled: true,
      accounts: [{ id: "primary", label: "Test", userId: "test", accessToken: "test-token", posts: "text" as const, offsetMinutes: 0 }]
    };
    const running = runDue(NOW, { config, log: () => {} });
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await mutateQueue((items) => ({
      items: [...items.filter((entry) => entry.id !== "removed").map((entry) => entry.id === "edited"
        ? { ...entry, text: "New dashboard copy", publishAt: "2026-10-04T18:00:00Z" }
        : entry), { ...item("pipeline-new", future), origin: "pipeline" as const }],
      result: undefined
    }));
    release();
    await running;
    const saved = await readQueue();
    expect(saved.find((entry) => entry.id === "sending")).toMatchObject({ status: "published", postId: "post-one" });
    expect(saved.find((entry) => entry.id === "edited")).toMatchObject({ text: "New dashboard copy", publishAt: "2026-10-04T18:00:00Z" });
    expect(saved.find((entry) => entry.id === "pipeline-new")).toBeDefined();
    expect(saved.find((entry) => entry.id === "removed")).toBeUndefined();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("does not resurrect a sending row deleted while its upload was in flight", () => {
    const before = item("removed");
    expect(mergeQueueChanges([before], [{ ...before, status: "published", postId: "landed" }], [])).toEqual([]);
  });

  it("preserves a rescheduled old row when pruning was based on an earlier snapshot", () => {
    const before = item("old", "2026-08-01T12:00:00Z");
    const edited = { ...before, publishAt: "2026-10-04T12:00:00Z" };
    expect(mergeQueueChanges([before], [], [edited])).toEqual([edited]);
    expect(mergeQueueChanges([before], [], [before])).toEqual([]);
  });
});
