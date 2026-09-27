import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PublishQueue } from "@/lib/publisher/queue";
import { FileQueueStore } from "@/lib/publisher/store";
import { testConfig, testItem } from "@/lib/publisher/test-helpers";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "queue-reload-"));
  file = path.join(dir, "publish-queue.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("a long-lived queue next to another writer", () => {
  it("sees what the other process saved instead of its first snapshot", async () => {
    const server = new PublishQueue(new FileQueueStore(file), testConfig());
    const runner = new PublishQueue(new FileQueueStore(file), testConfig());
    await server.add(testItem({ id: "a1", title: "First" }));

    const item = (await runner.get("a1"))!;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await runner.recordSuccess(item, "youtube", { status: "published", postId: "yt1" }, new Date());

    expect((await server.get("a1"))!.platforms.youtube?.status).toBe("published");
  });

  it("does not write its stale copy over the other process's progress", async () => {
    const server = new PublishQueue(new FileQueueStore(file), testConfig());
    const runner = new PublishQueue(new FileQueueStore(file), testConfig());
    await server.add(testItem({ id: "a1", title: "First" }));
    await server.list();

    const item = (await runner.get("a1"))!;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await runner.recordSuccess(item, "youtube", { status: "published", postId: "yt1" }, new Date());

    const edited = (await server.get("a1"))!;
    edited.caption = "New caption";
    await server.add(edited);

    const fresh = new PublishQueue(new FileQueueStore(file), testConfig());
    const saved = (await fresh.get("a1"))!;
    expect(saved.caption).toBe("New caption");
    expect(saved.platforms.youtube?.status).toBe("published");
  });
});
