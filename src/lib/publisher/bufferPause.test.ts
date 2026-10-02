import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { setAutomationPaused } from "@/lib/automations/store";
import { syncDueToBuffer } from "@/lib/publisher/buffer";
import { PublishQueue } from "@/lib/publisher/queue";
import { MemoryQueueStore, jsonResponse, mockFetchRoutes, testConfig, testItem } from "@/lib/publisher/test-helpers";

beforeEach(async () => {
  await rm(dataPath("automations"), { recursive: true, force: true });
});

afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const config = testConfig({ buffer: { enabled: true, accessToken: "test", profileIds: ["test"], apiBase: "https://example.test", shortenLinks: false } });
  const queue = new PublishQueue(new MemoryQueueStore(), config);
  await queue.add(testItem({ id: "first" }));
  await queue.add(testItem({ id: "second" }));
  return { config, queue, log: () => undefined };
}

describe("Buffer pause boundary", () => {
  it("finishes the in-flight post and leaves the next post untouched", async () => {
    const options = await setup();
    const requests = mockFetchRoutes([{ match: "/updates/create.json", respond: async () => {
      await setAutomationPaused("publisher", true);
      return jsonResponse({ success: true, updates: [{ id: "update" }] });
    } }]);
    const outcomes = await syncDueToBuffer(new Date("2026-07-10T22:31:00.000Z"), options);
    expect(requests).toHaveLength(1);
    expect(outcomes).toHaveLength(1);
    expect((await options.queue.get("first"))?.buffer?.status).toBe("scheduled");
    expect((await options.queue.get("second"))?.buffer).toBeUndefined();
  });

  it("allows an explicit per-item action while automatic publishing is paused", async () => {
    const options = await setup();
    await setAutomationPaused("publisher", true);
    const requests = mockFetchRoutes([{ match: "/updates/create.json", respond: () => jsonResponse({ success: true, updates: [{ id: "update" }] }) }]);
    await syncDueToBuffer(new Date("2026-07-10T22:31:00.000Z"), { ...options, itemId: "second" });
    expect(requests).toHaveLength(1);
    expect((await options.queue.get("first"))?.buffer).toBeUndefined();
    expect((await options.queue.get("second"))?.buffer?.status).toBe("scheduled");
  });
});
