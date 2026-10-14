import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HOLD_EVERYTHING } from "@/lib/publisher/approval";
import { PublishQueue } from "@/lib/publisher/queue";
import { FileQueueStore } from "@/lib/publisher/store";
import { MemoryQueueStore, testConfig, testItem } from "@/lib/publisher/test-helpers";
import type { QueueItem } from "@/lib/publisher/types";

const NOW = new Date("2026-08-10T16:00:00.000Z");
const OLD = "2026-08-08T16:00:00.000Z";
let dir: string;
let file: string;
const config = () => testConfig({ platforms: ["youtube", "instagram"], shortsPerDay: 1 });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

class PausedStore extends FileQueueStore {
  beforeLock?: () => Promise<void>;
  override async withLock<T>(work: () => Promise<T>): Promise<T> {
    await this.beforeLock?.();
    return super.withLock(work);
  }
}

class FailingStore extends FileQueueStore {
  failNext = false;
  override async save(text: string): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("injected atomic swap failure");
    }
    return super.save(text);
  }
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "review-release-contract-"));
  file = path.join(dir, "publish-queue.json");
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

async function seed(ids: string[], multi = false) {
  const queue = new PublishQueue(new FileQueueStore(file), config());
  for (const id of ids) {
    const item = testItem({ id, clipPath: `data/clips/outputs/job1/${id}.mp4`, publishAt: OLD, platformIds: multi ? ["youtube", "instagram"] : ["instagram"] });
    if (multi) item.platforms.youtube = { status: "scheduled", postId: `yt-${id}`, attempts: 1 };
    await queue.add(item);
  }
}

const onDisk = async (): Promise<QueueItem[]> => JSON.parse(await readFile(file, "utf8"));

async function twoReleases(ids: [string, string]) {
  const ready = deferred();
  const proceed = deferred();
  let arrived = 0;
  const stores = [new PausedStore(file), new PausedStore(file)];
  const queues = stores.map((store) => new PublishQueue(store, config()));
  await Promise.all(queues.map((queue) => queue.list()));
  for (const store of stores) store.beforeLock = async () => {
    arrived += 1;
    if (arrived === 2) ready.resolve();
    await proceed.promise;
  };
  const releases = queues.map((queue, index) => queue.releaseLegs([{ id: ids[index], platform: "instagram" }], NOW));
  await ready.promise;
  proceed.resolve();
  return Promise.all(releases);
}

describe("bounded later-wave release contract", () => {
  it("two stale releases reserve distinct slots under the shared file lock", async () => {
    await seed(["a", "b"]);
    await twoReleases(["a", "b"]);
    const released = (await onDisk()).filter((item) => item.platforms.instagram?.approvedAt);
    expect(released).toHaveLength(2);
    expect(new Set(released.map((item) => item.publishAt)).size).toBe(2);
  });

  it("simultaneous approval of the same stale multi-leg post creates one detached leg", async () => {
    await seed(["a"], true);
    const results = await twoReleases(["a", "a"]);
    expect((await onDisk()).filter((item) => item.platforms.instagram)).toHaveLength(1);
    expect(results.reduce((sum, result) => sum + result.approved, 0)).toBe(1);
    expect((await onDisk()).find((item) => item.id === "a")?.platforms.youtube?.postId).toBe("yt-a");
  });

  it("a removal that commits before release's lock does not leave a detached orphan", async () => {
    await seed(["a"], true);
    const ready = deferred();
    const proceed = deferred();
    const store = new PausedStore(file);
    const queue = new PublishQueue(store, config());
    await queue.list();
    store.beforeLock = async () => { ready.resolve(); await proceed.promise; };
    const releasing = queue.releaseLegs([{ id: "a", platform: "instagram" }], NOW);
    await ready.promise;
    await new PublishQueue(new FileQueueStore(file), config()).remove("a");
    proceed.resolve();
    const result = await releasing;
    expect(await onDisk()).toEqual([]);
    expect(result.approved).toBe(0);
  });

  it("a failed release save leaves disk, held references and in-memory approvals unchanged", async () => {
    await seed(["a"], true);
    const store = new FailingStore(file);
    const queue = new PublishQueue(store, config());
    const held = (await queue.get("a"))!;
    const heldLeg = held.platforms.instagram!;
    const dueBefore = queue.duePlatforms(held, NOW, HOLD_EVERYTHING);
    const before = await readFile(file, "utf8");
    store.failNext = true;
    await expect(queue.releaseLegs([{ id: "a", platform: "instagram" }], NOW)).rejects.toThrow("injected atomic swap failure");
    expect(await readFile(file, "utf8")).toBe(before);
    expect((await queue.list()).map((item) => item.id)).toEqual(["a"]);
    expect(held.platforms.instagram).toBe(heldLeg);
    expect(heldLeg.approvedAt).toBeUndefined();
    expect(queue.duePlatforms(held, NOW, HOLD_EVERYTHING)).toEqual(dueBefore);
    expect(queue.duePlatforms(held, NOW, HOLD_EVERYTHING)).not.toContain("instagram");
  });

  it("an unrelated save cannot later persist approval from a rejected release", async () => {
    await seed(["a"], true);
    const store = new FailingStore(file);
    const queue = new PublishQueue(store, config());
    await queue.list();
    store.failNext = true;
    await expect(queue.releaseLegs([{ id: "a", platform: "instagram" }], NOW)).rejects.toThrow("injected atomic swap failure");
    await queue.save();
    const saved = await onDisk();
    expect(saved).toHaveLength(1);
    expect(saved[0].platforms.instagram?.approvedAt).toBeUndefined();
    expect(saved[0].publishAt).toBe(OLD);
  });

  it("does not release a leg another runner claimed before the lock", async () => {
    await seed(["a"], true);
    const ready = deferred();
    const proceed = deferred();
    const store = new PausedStore(file);
    const queue = new PublishQueue(store, config());
    await queue.list();
    store.beforeLock = async () => { ready.resolve(); await proceed.promise; };
    const releasing = queue.releaseLegs([{ id: "a", platform: "instagram" }], NOW);
    await ready.promise;
    const runner = new PublishQueue(new FileQueueStore(file), config());
    const held = (await runner.get("a"))!;
    expect(await runner.claim(held, "instagram", NOW)).toBe(true);
    proceed.resolve();
    expect((await releasing).approved).toBe(0);
    const saved = await onDisk();
    expect(saved).toHaveLength(1);
    expect(saved[0].platforms.instagram?.claimedAt).toBe(NOW.toISOString());
    expect(saved[0].platforms.instagram?.approvedAt).toBeUndefined();
    expect(saved[0].publishAt).toBe(OLD);
  });

  it("preserves a caller's caption edit queued while the release save waits", async () => {
    await seed(["a"], true);
    const ready = deferred();
    const proceed = deferred();
    class PausedSaveStore extends FileQueueStore {
      override async save(text: string): Promise<void> {
        ready.resolve();
        await proceed.promise;
        return super.save(text);
      }
    }
    const queue = new PublishQueue(new PausedSaveStore(file), config());
    const held = (await queue.get("a"))!;
    const releasing = queue.releaseLegs([{ id: "a", platform: "instagram" }], NOW);
    await ready.promise;
    held.caption = "A caption edited during the save";
    const savingEdit = queue.save();
    proceed.resolve();
    await Promise.all([releasing, savingEdit]);
    expect(await queue.get("a")).toBe(held);
    expect(held.caption).toBe("A caption edited during the save");
    expect((await onDisk()).find((item) => item.id === "a")?.caption).toBe(held.caption);
    expect((await onDisk()).filter((item) => item.platforms.instagram)).toHaveLength(1);
  });

  it("rechecks an ambiguous committed save before retrying a split, even without version metadata", async () => {
    class AmbiguousStore extends MemoryQueueStore {
      failAfterSave = false;
      override async save(text: string): Promise<void> {
        await super.save(text);
        if (this.failAfterSave) {
          this.failAfterSave = false;
          throw new Error("save response lost after commit");
        }
      }
    }
    const store = new AmbiguousStore();
    const queue = new PublishQueue(store, config());
    const item = testItem({ id: "a", publishAt: OLD, platformIds: ["youtube", "instagram"] });
    item.platforms.youtube = { status: "scheduled", postId: "yt-a", attempts: 1 };
    await queue.add(item);
    store.failAfterSave = true;
    await expect(queue.releaseLegs([{ id: "a", platform: "instagram" }], NOW)).rejects.toThrow("save response lost");
    const committed = store.text;
    const retried = await queue.releaseLegs([{ id: "a", platform: "instagram" }], NOW);
    expect(retried.approved).toBe(0);
    expect(store.text).toBe(committed);
    expect((await queue.list()).filter((entry) => entry.platforms.instagram)).toHaveLength(1);
    expect(JSON.parse(store.text!).find((entry: QueueItem) => entry.id === "a").platforms.youtube.postId).toBe("yt-a");
  });

  it("does not report a durable release as failed when version metadata is unavailable afterwards", async () => {
    await seed(["a"], true);
    class MetadataFailureStore extends FileQueueStore {
      committed = false;
      override async version(): Promise<string | null> {
        if (this.committed) throw new Error("metadata unavailable after save");
        return super.version();
      }
      override async save(text: string): Promise<void> {
        await super.save(text);
        this.committed = true;
      }
    }
    const queue = new PublishQueue(new MetadataFailureStore(file), config());
    await expect(queue.releaseLegs([{ id: "a", platform: "instagram" }], NOW)).resolves.toMatchObject({ approved: 1 });
    expect((await onDisk()).filter((item) => item.platforms.instagram?.approvedAt)).toHaveLength(1);
  });
});
