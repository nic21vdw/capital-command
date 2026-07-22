import { afterEach, describe, expect, it, vi } from "vitest";
import { syncDueToBuffer } from "@/lib/publisher/buffer";
import { PublishQueue } from "@/lib/publisher/queue";
import { MemoryQueueStore, jsonResponse, mockFetchRoutes, testConfig, testItem } from "@/lib/publisher/test-helpers";
import type { PublisherConfig } from "@/lib/publisher/config";
import type { RecordedRequest } from "@/lib/publisher/test-helpers";

/**
 * Mocked integration tests for the Buffer delivery pass: assert the outgoing
 * create.json request matches Buffer's classic API and that state transitions
 * (schedule → finalize) and idempotency hold. No live calls.
 */

const DUE = new Date("2026-07-10T22:31:00.000Z");
const NOT_DUE = new Date("2026-07-10T22:00:00.000Z"); // before publishAt 22:30

function bufferConfig(overrides: Partial<PublisherConfig["buffer"]> = {}): PublisherConfig {
  return testConfig({
    buffer: {
      enabled: true,
      accessToken: "buf-token",
      profileIds: ["prof-1", "prof-2"],
      apiBase: "https://api.bufferapp.com/1",
      shortenLinks: true,
      ...overrides
    }
  });
}

function bodyParams(request: RecordedRequest): URLSearchParams {
  return request.body instanceof URLSearchParams ? request.body : new URLSearchParams(String(request.body));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function queueWith(config: PublisherConfig, ...items: Parameters<typeof testItem>) {
  const queue = new PublishQueue(new MemoryQueueStore(), config);
  await queue.add(testItem(...items));
  return queue;
}

describe("syncDueToBuffer", () => {
  it("schedules a pending item into Buffer with the caption, target time and every profile", async () => {
    const config = bufferConfig();
    const queue = await queueWith(config, { platformIds: ["youtube"], caption: "Great clip", hashtags: ["#ai"] });
    const requests = mockFetchRoutes([
      { match: "/updates/create.json", respond: () => jsonResponse({ success: true, updates: [{ id: "u1" }, { id: "u2" }] }) }
    ]);

    const outcomes = await syncDueToBuffer(DUE, { queue, config });

    expect(requests).toHaveLength(1);
    const create = requests[0];
    expect(create.url).toBe("https://api.bufferapp.com/1/updates/create.json");
    expect((create.headers as Record<string, string>).Authorization).toBe("Bearer buf-token");
    const params = bodyParams(create);
    expect(params.getAll("profile_ids[]")).toEqual(["prof-1", "prof-2"]);
    expect(params.get("text")).toBe("Great clip\n\n#ai");
    expect(params.get("scheduled_at")).toBe("2026-07-10T22:30:00.000Z");
    expect(params.get("shorten")).toBe("true");

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe("scheduled");

    const stored = (await queue.list())[0];
    expect(stored.buffer?.status).toBe("scheduled");
    expect(stored.buffer?.updateIds).toEqual(["u1", "u2"]);
  });

  it("attaches the hosted public URL as media when the item is hosted", async () => {
    const config = bufferConfig();
    const queue = await queueWith(config, { platformIds: ["youtube"], mediaKey: "clips/item1.mp4" });
    // hosting.mediaHost is only built when the S3 vars are set; with none set it
    // returns null, so no media is attached even with a mediaKey.
    const requests = mockFetchRoutes([
      { match: "/updates/create.json", respond: () => jsonResponse({ success: true, updates: [{ id: "u1" }] }) }
    ]);

    await syncDueToBuffer(DUE, { queue, config });

    expect(bodyParams(requests[0]).get("media[link]")).toBeNull();
  });

  it("does not re-schedule an item that is already scheduled and not yet due to finalize", async () => {
    const config = bufferConfig();
    const queue = await queueWith(config, {
      platformIds: ["youtube"],
      buffer: { status: "scheduled", attempts: 0, updateIds: ["u1"] }
    });
    const requests = mockFetchRoutes([]);

    const outcomes = await syncDueToBuffer(NOT_DUE, { queue, config });

    expect(requests).toHaveLength(0);
    expect(outcomes).toHaveLength(0);
  });

  it("finalizes a scheduled item to published once Buffer reports every update sent", async () => {
    const config = bufferConfig();
    const queue = await queueWith(config, {
      platformIds: ["youtube"],
      buffer: { status: "scheduled", attempts: 0, updateIds: ["u1", "u2"] }
    });
    mockFetchRoutes([{ match: "/updates/", respond: () => jsonResponse({ id: "u1", status: "sent" }) }]);

    const outcomes = await syncDueToBuffer(DUE, { queue, config });

    expect(outcomes[0].outcome).toBe("published");
    expect((await queue.list())[0].buffer?.status).toBe("published");
  });

  it("keeps an item scheduled when Buffer still holds the update", async () => {
    const config = bufferConfig();
    const queue = await queueWith(config, {
      platformIds: ["youtube"],
      buffer: { status: "scheduled", attempts: 0, updateIds: ["u1"] }
    });
    mockFetchRoutes([{ match: "/updates/", respond: () => jsonResponse({ id: "u1", status: "buffer" }) }]);

    const outcomes = await syncDueToBuffer(DUE, { queue, config });

    expect(outcomes[0].outcome).toBe("scheduled");
    expect((await queue.list())[0].buffer?.status).toBe("scheduled");
  });

  it("records a reminder instead of failing when Buffer is enabled but not connected", async () => {
    const config = bufferConfig({ accessToken: null, profileIds: [] });
    const queue = await queueWith(config, { platformIds: ["youtube"] });
    const requests = mockFetchRoutes([]);

    const outcomes = await syncDueToBuffer(DUE, { queue, config });

    expect(requests).toHaveLength(0);
    expect(outcomes[0].outcome).toBe("manual");
    expect((await queue.list())[0].buffer?.status).toBe("manual");
  });

  it("does nothing at all when Buffer is disabled", async () => {
    const config = testConfig(); // buffer.enabled === false
    const queue = await queueWith(config, { platformIds: ["youtube"] });
    const requests = mockFetchRoutes([]);

    const outcomes = await syncDueToBuffer(DUE, { queue, config });

    expect(requests).toHaveLength(0);
    expect(outcomes).toHaveLength(0);
    expect((await queue.list())[0].buffer).toBeUndefined();
  });

  it("retries on a transient Buffer error and marks failed on a permanent one", async () => {
    const config = bufferConfig();
    // 500 → transient (retry); item stays pending with a backoff.
    const queue = await queueWith(config, { platformIds: ["youtube"] });
    mockFetchRoutes([
      { match: "/updates/create.json", respond: () => jsonResponse({ message: "boom" }, { status: 500 }) }
    ]);

    const outcomes = await syncDueToBuffer(DUE, { queue, config });

    expect(outcomes[0].outcome).toBe("retrying");
    const stored = (await queue.list())[0];
    expect(stored.buffer?.status).toBe("pending");
    expect(stored.buffer?.nextAttemptAt).toBeTruthy();
  });
});
