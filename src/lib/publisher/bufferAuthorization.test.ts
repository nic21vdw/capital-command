import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAutomationPaused } from "@/lib/automations/store";
import { recordAutomationEventSafely } from "@/lib/automations/history";
import { dataPath } from "@/lib/paths";
import { DEFAULT_REVIEW_POLICY } from "@/lib/publisher/approval";
import { resetReviewPolicyCache, writeReviewPolicy } from "@/lib/publisher/approvalStore";
import { syncDueToBuffer } from "@/lib/publisher/buffer";
import { PublishQueue } from "@/lib/publisher/queue";
import { FileQueueStore } from "@/lib/publisher/store";
import { jsonResponse, mockFetchRoutes, testConfig, testItem } from "@/lib/publisher/test-helpers";

const media = vi.hoisted(() => ({ url: vi.fn() }));
vi.mock("@/lib/publisher/hosting", () => ({ mediaHost: () => ({ publicUrl: media.url }) }));
vi.mock("@/lib/automations/store", () => ({ isAutomationPaused: vi.fn(async () => false) }));
vi.mock("@/lib/automations/history", () => ({ recordAutomationEventSafely: vi.fn(async () => {}) }));

const NOW = new Date("2026-07-10T22:31:00.000Z");
const config = () => testConfig({ buffer: {
  enabled: true, accessToken: "buffer-fixture", profileIds: ["profile-fixture"], apiBase: "https://buffer.example.test", shortenLinks: true
} });
const hold = () => writeReviewPolicy({ instagram: "hold" });
const quiet = () => {};
let file: string;

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.mocked(isAutomationPaused).mockReset().mockResolvedValue(false);
  vi.mocked(recordAutomationEventSafely).mockClear();
  media.url.mockReset().mockResolvedValue("https://media.example.test/fixture.mp4");
  resetReviewPolicyCache();
  await writeReviewPolicy(DEFAULT_REVIEW_POLICY);
  file = dataPath(`buffer-authorization-${crypto.randomUUID()}.json`);
});

async function seed(ids = ["first"], hosted = false) {
  const queue = new PublishQueue(new FileQueueStore(file), config());
  for (const id of ids) await queue.add(testItem({ id, platformIds: ["instagram"], ...(hosted ? { mediaKey: "fixture.mp4" } : {}) }));
  return queue;
}
const requests = () => mockFetchRoutes([{ match: "/updates/create.json", respond: () => jsonResponse({ success: true, updates: [{ id: "accepted-fixture" }] }) }]);
const stored = async () => JSON.parse(await readFile(file, "utf8")) as Awaited<ReturnType<PublishQueue["list"]>>;

describe("Buffer authorization remains current until dispatch", () => {
  it("honors Hold enabled while the queue list awaits", async () => {
    const queue = await seed();
    const list = queue.list.bind(queue);
    vi.spyOn(queue, "list").mockImplementation(async () => { const rows = await list(); await hold(); return rows; });
    const calls = requests();
    expect(await syncDueToBuffer(NOW, { queue, config: config(), log: quiet })).toEqual([]);
    expect(calls).toHaveLength(0);
    expect((await stored())[0].buffer).toBeUndefined();
    expect(recordAutomationEventSafely).not.toHaveBeenCalled();
  });

  it("honors Hold enabled during the asynchronous automation check", async () => {
    const queue = await seed();
    vi.mocked(isAutomationPaused).mockImplementationOnce(async () => { await hold(); return false; });
    const calls = requests();
    expect(await syncDueToBuffer(NOW, { queue, config: config(), log: quiet })).toEqual([]);
    expect(calls).toHaveLength(0);
    expect((await stored())[0].buffer).toBeUndefined();
  });

  it("checks the latest policy while holding the queue claim lock", async () => {
    await seed();
    class GatedStore extends FileQueueStore {
      override async withLock<T>(work: () => Promise<T>): Promise<T> {
        await hold();
        return super.withLock(work);
      }
    }
    const queue = new PublishQueue(new GatedStore(file), config());
    const calls = requests();
    expect(await syncDueToBuffer(NOW, { queue, config: config(), log: quiet })).toEqual([]);
    expect(calls).toHaveLength(0);
    expect((await stored())[0].buffer).toBeUndefined();
  });

  it("releases its claim without retry or history when Hold arrives while media is prepared", async () => {
    const queue = await seed(["first"], true);
    media.url.mockImplementationOnce(async () => { await hold(); return "https://media.example.test/fixture.mp4"; });
    const calls = requests();
    expect(await syncDueToBuffer(NOW, { queue, config: config(), log: quiet })).toEqual([]);
    expect(calls).toHaveLength(0);
    expect((await stored())[0].buffer).toMatchObject({ status: "pending", attempts: 0 });
    expect((await stored())[0].buffer?.claimedAt).toBeUndefined();
    expect((await stored())[0].buffer?.nextAttemptAt).toBeUndefined();
    expect(recordAutomationEventSafely).not.toHaveBeenCalled();
  });

  it("does not spend a retry when media preparation rejects after Hold was enabled", async () => {
    const queue = await seed(["first"], true);
    media.url.mockImplementationOnce(async () => { await hold(); throw new Error("synthetic media error"); });
    const calls = requests();
    expect(await syncDueToBuffer(NOW, { queue, config: config(), log: quiet })).toEqual([]);
    expect(calls).toHaveLength(0);
    expect((await stored())[0].buffer).toMatchObject({ status: "pending", attempts: 0 });
    expect((await stored())[0].buffer?.claimedAt).toBeUndefined();
    expect((await stored())[0].buffer?.nextAttemptAt).toBeUndefined();
    expect(recordAutomationEventSafely).not.toHaveBeenCalled();
  });

  it("keeps the delivery failure when Hold arrives after create has already started", async () => {
    const queue = await seed();
    const calls = mockFetchRoutes([{ match: "/updates/create.json", respond: async () => {
      await hold();
      return jsonResponse({ message: "synthetic server failure" }, { status: 500 });
    } }]);
    expect(await syncDueToBuffer(NOW, { queue, config: config(), log: quiet })).toMatchObject([{ outcome: "retrying" }]);
    expect(calls).toHaveLength(1);
    expect((await stored())[0].buffer).toMatchObject({ status: "pending", attempts: 1 });
    expect((await stored())[0].buffer?.nextAttemptAt).toBeDefined();
    expect(recordAutomationEventSafely).toHaveBeenCalledOnce();
  });

  it("does not apply an earlier item's authorization to the next item", async () => {
    const queue = await seed(["first", "second"]);
    const calls = mockFetchRoutes([{ match: "/updates/create.json", respond: async () => {
      await hold();
      return jsonResponse({ success: true, updates: [{ id: "accepted-fixture" }] });
    } }]);
    const outcomes = await syncDueToBuffer(NOW, { queue, config: config(), log: quiet });
    expect(calls).toHaveLength(1);
    expect(outcomes).toHaveLength(1);
    expect((await stored()).find((item) => item.id === "second")?.buffer).toBeUndefined();
  });

  it("does not accept an unscoped force flag as the owner's approval", async () => {
    const queue = await seed();
    await hold();
    const calls = requests();
    expect(await syncDueToBuffer(NOW, { queue, config: config(), force: true, log: quiet })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("fails closed for a held channel absent from the direct-platform legs", async () => {
    const queue = new PublishQueue(new FileQueueStore(file), config());
    await queue.add(testItem({ id: "first", platformIds: ["youtube"] }));
    await hold();
    const calls = requests();
    expect(await syncDueToBuffer(NOW, { queue, config: config(), log: quiet })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("retains explicit per-item force and an existing approval on a held leg", async () => {
    const queue = await seed(["first", "second"]);
    await hold();
    const second = (await queue.get("second"))!;
    second.platforms.instagram!.approvedAt = NOW.toISOString();
    await queue.save();
    const calls = requests();
    expect(await syncDueToBuffer(NOW, { queue, config: config(), itemId: "first", force: true, log: quiet })).toHaveLength(1);
    expect(await syncDueToBuffer(NOW, { queue, config: config(), itemId: "second", log: quiet })).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect((await stored()).find((item) => item.id === "second")?.platforms.instagram?.approvedAt).toBe(NOW.toISOString());
  });

  it("does not treat a direct-platform lease as approval for Buffer", async () => {
    const queue = await seed();
    const item = (await queue.get("first"))!;
    item.platforms.instagram!.claimedAt = NOW.toISOString();
    await queue.save();
    await hold();
    const calls = requests();
    expect(await syncDueToBuffer(NOW, { queue, config: config(), log: quiet })).toEqual([]);
    expect(calls).toHaveLength(0);
    expect((await stored())[0].platforms.instagram?.claimedAt).toBe(NOW.toISOString());
  });

  it("keeps finalizing an existing Buffer receipt under Hold without another create", async () => {
    const queue = await seed();
    const item = (await queue.get("first"))!;
    await queue.recordBufferSuccess(item, { status: "scheduled", updateIds: ["existing-receipt"] }, NOW);
    await hold();
    const calls = mockFetchRoutes([{ match: "/updates/existing-receipt.json", respond: () => jsonResponse({ status: "sent" }) }]);
    expect(await syncDueToBuffer(NOW, { queue, config: config(), log: quiet })).toMatchObject([{ outcome: "published" }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect((await stored())[0].buffer).toMatchObject({ status: "published", attempts: 0, updateIds: ["existing-receipt"] });
  });

  it("revalidates a competing receipt before claiming a stale pending item", async () => {
    await seed();
    let injected = false;
    class ReceiptStore extends FileQueueStore {
      override async withLock<T>(work: () => Promise<T>): Promise<T> {
        if (!injected) {
          injected = true;
          const other = new PublishQueue(new FileQueueStore(file), config());
          await other.recordBufferSuccess((await other.get("first"))!, { status: "scheduled", updateIds: ["other-receipt"] }, NOW);
        }
        return super.withLock(work);
      }
    }
    const queue = new PublishQueue(new ReceiptStore(file), config());
    const calls = requests();
    expect(await syncDueToBuffer(NOW, { queue, config: config(), log: quiet })).toEqual([]);
    expect(calls).toHaveLength(0);
    expect((await stored())[0].buffer?.updateIds).toEqual(["other-receipt"]);
    expect((await stored())[0].buffer?.claimedAt).toBeUndefined();
  });

  it("does not recreate a queue row cancelled during media preparation", async () => {
    const queue = await seed(["first"], true);
    media.url.mockImplementationOnce(async () => {
      const other = new PublishQueue(new FileQueueStore(file), config());
      await other.remove("first");
      return "https://media.example.test/fixture.mp4";
    });
    const calls = requests();
    expect(await syncDueToBuffer(NOW, { queue, config: config(), log: quiet })).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(await stored()).toEqual([]);
    expect(recordAutomationEventSafely).not.toHaveBeenCalled();
  });

  it("reads the queue again after the final asynchronous pause check", async () => {
    const queue = await seed();
    vi.mocked(isAutomationPaused).mockResolvedValueOnce(false).mockImplementationOnce(async () => {
      const other = new PublishQueue(new FileQueueStore(file), config());
      await other.remove("first");
      return false;
    });
    const calls = requests();
    expect(await syncDueToBuffer(NOW, { queue, config: config(), log: quiet })).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(await stored()).toEqual([]);
    expect(recordAutomationEventSafely).not.toHaveBeenCalled();
  });

  it("does not clear a replacement worker's lease after its media wait", async () => {
    const queue = await seed(["first"], true);
    const replacement = new Date(NOW.getTime() + 60_000).toISOString();
    media.url.mockImplementationOnce(async () => {
      const other = new PublishQueue(new FileQueueStore(file), config());
      const item = (await other.get("first"))!;
      item.buffer!.claimedAt = replacement;
      await other.save();
      await hold();
      return "https://media.example.test/fixture.mp4";
    });
    const calls = requests();
    expect(await syncDueToBuffer(NOW, { queue, config: config(), log: quiet })).toEqual([]);
    expect(calls).toHaveLength(0);
    expect((await stored())[0].buffer).toMatchObject({ claimedAt: replacement, attempts: 0, status: "pending" });
  });

  it("allows only one of two concurrent workers to dispatch", async () => {
    const queue = await seed();
    const other = new PublishQueue(new FileQueueStore(file), config());
    const calls = requests();
    const results = await Promise.all([
      syncDueToBuffer(NOW, { queue, config: config(), log: quiet }),
      syncDueToBuffer(NOW, { queue: other, config: config(), log: quiet })
    ]);
    expect(calls).toHaveLength(1);
    expect(results.flat()).toHaveLength(1);
    expect((await stored())[0].buffer?.updateIds).toEqual(["accepted-fixture"]);
  });

  it("surfaces an authorization-cleanup save failure without retry state or history", async () => {
    await seed(["first"], true);
    let refuseCleanup = false;
    class FailingStore extends FileQueueStore {
      override async save(text: string): Promise<void> {
        if (refuseCleanup) throw new Error("synthetic cleanup storage failure");
        await super.save(text);
      }
    }
    const queue = new PublishQueue(new FailingStore(file), config());
    media.url.mockImplementationOnce(async () => {
      await hold();
      refuseCleanup = true;
      return "https://media.example.test/fixture.mp4";
    });
    const calls = requests();
    await expect(syncDueToBuffer(NOW, { queue, config: config(), log: quiet })).rejects.toThrow("synthetic cleanup storage failure");
    expect(calls).toHaveLength(0);
    const item = (await stored())[0];
    expect(item.buffer).toMatchObject({ claimedAt: NOW.toISOString(), attempts: 0, status: "pending" });
    expect(item.buffer?.nextAttemptAt).toBeUndefined();
    expect(recordAutomationEventSafely).not.toHaveBeenCalled();
  });
});
