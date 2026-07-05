import { describe, expect, it } from "vitest";
import { PublishQueue } from "@/lib/publisher/queue";
import { MemoryQueueStore, testConfig, testItem } from "@/lib/publisher/test-helpers";

const PUBLISH_AT = "2026-07-10T22:30:00.000Z";
const BEFORE = new Date("2026-07-10T22:00:00.000Z");
const DUE = new Date("2026-07-10T22:31:00.000Z");

function makeQueue() {
  const store = new MemoryQueueStore();
  return { store, queue: new PublishQueue(store, testConfig()) };
}

describe("publish queue state machine", () => {
  it("YouTube is due immediately; Instagram/TikTok only once publishAt passes", async () => {
    const { queue } = makeQueue();
    const item = testItem({ publishAt: PUBLISH_AT });
    await queue.add(item);

    expect(queue.duePlatforms(item, BEFORE)).toEqual(["youtube"]);
    expect(queue.duePlatforms(item, DUE).sort()).toEqual(["instagram", "tiktok", "youtube"]);
  });

  it("terminal states are never due again (idempotency)", async () => {
    const { queue } = makeQueue();
    const item = testItem({ publishAt: PUBLISH_AT });
    await queue.add(item);

    await queue.recordSuccess(item, "youtube", { status: "scheduled", postId: "vid123" }, DUE);
    await queue.recordSuccess(item, "instagram", { status: "published", postId: "media456" }, DUE);
    await queue.recordFailure(item, "tiktok", { message: "bad request", transient: false }, DUE);

    expect(queue.duePlatforms(item, DUE)).toEqual([]);
    expect(item.platforms.youtube?.postId).toBe("vid123");
    expect(item.platforms.instagram?.publishedAt).toBe(DUE.toISOString());
    expect(item.platforms.tiktok?.status).toBe("failed");
    expect(item.platforms.tiktok?.error).toBe("bad request");
  });

  it("stamps uploadedAt once on first success, for the quota meter", async () => {
    const { queue } = makeQueue();
    const item = testItem({ publishAt: PUBLISH_AT, platformIds: ["instagram"] });
    await queue.add(item);

    await queue.recordSuccess(item, "instagram", { status: "uploaded", containerId: "c1" }, DUE);
    expect(item.platforms.instagram?.uploadedAt).toBe(DUE.toISOString());
    const later = new Date(DUE.getTime() + 5 * 60_000);
    await queue.recordSuccess(item, "instagram", { status: "published", postId: "m1" }, later);
    expect(item.platforms.instagram?.uploadedAt).toBe(DUE.toISOString());
  });

  it("manual posts (unconfigured platforms) are reminders, never due for the runner", async () => {
    const { queue } = makeQueue();
    const item = testItem({ publishAt: PUBLISH_AT, platformIds: ["tiktok"] });
    item.platforms.tiktok!.status = "manual";
    await queue.add(item);

    expect(queue.duePlatforms(item, DUE)).toEqual([]);
    expect(queue.duePlatforms(item, new Date("2027-01-01T00:00:00Z"))).toEqual([]);
  });

  it("transient failures back off exponentially, then fail permanently at maxAttempts", async () => {
    const { queue } = makeQueue();
    const item = testItem({ publishAt: PUBLISH_AT, platformIds: ["tiktok"] });
    await queue.add(item);

    await queue.recordFailure(item, "tiktok", { message: "HTTP 500", transient: true }, DUE);
    const state = item.platforms.tiktok!;
    expect(state.status).toBe("pending");
    expect(state.attempts).toBe(1);
    // First retry: 2 min backoff.
    expect(state.nextAttemptAt).toBe(new Date(DUE.getTime() + 2 * 60_000).toISOString());
    expect(queue.duePlatforms(item, DUE)).toEqual([]);
    expect(queue.duePlatforms(item, new Date(DUE.getTime() + 3 * 60_000))).toEqual(["tiktok"]);

    await queue.recordFailure(item, "tiktok", { message: "HTTP 500", transient: true }, DUE);
    // Second retry: 4 min backoff.
    expect(state.nextAttemptAt).toBe(new Date(DUE.getTime() + 4 * 60_000).toISOString());

    // maxAttempts (3) reached → permanent.
    await queue.recordFailure(item, "tiktok", { message: "HTTP 500", transient: true }, DUE);
    expect(state.status).toBe("failed");
    expect(queue.duePlatforms(item, new Date(DUE.getTime() + 60 * 60_000))).toEqual([]);
  });

  it("a fresh claim blocks re-processing until the claim times out", async () => {
    const { queue } = makeQueue();
    const item = testItem({ publishAt: PUBLISH_AT, platformIds: ["instagram"] });
    await queue.add(item);

    await queue.claim(item, "instagram", DUE);
    expect(queue.duePlatforms(item, new Date(DUE.getTime() + 60_000))).toEqual([]);
    // claimTimeoutMinutes = 15 in the test config.
    expect(queue.duePlatforms(item, new Date(DUE.getTime() + 16 * 60_000))).toEqual(["instagram"]);
  });

  it("uploaded (still processing) items stay resumable with their container id", async () => {
    const { queue } = makeQueue();
    const item = testItem({ publishAt: PUBLISH_AT, platformIds: ["tiktok"] });
    await queue.add(item);

    await queue.recordSuccess(item, "tiktok", { status: "uploaded", containerId: "publish-1" }, DUE);
    expect(item.platforms.tiktok?.status).toBe("uploaded");
    expect(item.platforms.tiktok?.containerId).toBe("publish-1");
    expect(queue.duePlatforms(item, new Date(DUE.getTime() + 60_000))).toEqual(["tiktok"]);
  });

  it("persists through the store and reloads identically", async () => {
    const { store, queue } = makeQueue();
    const item = testItem({ publishAt: PUBLISH_AT });
    await queue.add(item);
    await queue.recordSuccess(item, "youtube", { status: "scheduled", postId: "vid123" }, DUE);

    const reloaded = new PublishQueue(store, testConfig());
    const items = await reloaded.list();
    expect(items).toHaveLength(1);
    expect(items[0].platforms.youtube?.status).toBe("scheduled");
    expect(items[0].platforms.youtube?.postId).toBe("vid123");
  });
});
