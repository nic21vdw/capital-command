import { describe, expect, it } from "vitest";
import { planMirror } from "@/lib/publisher/mirror";
import { PublishQueue } from "@/lib/publisher/queue";
import { MemoryQueueStore, testConfig, testItem } from "@/lib/publisher/test-helpers";

const NOW = new Date("2026-08-10T16:00:00.000Z");
const HOUR = 3_600_000;
const iso = (hours: number) => new Date(NOW.getTime() + hours * HOUR).toISOString();

const queueWith = async (items: ReturnType<typeof testItem>[], over: Parameters<typeof testConfig>[0] = {}) => {
  const queue = new PublishQueue(new MemoryQueueStore(), testConfig({ platforms: ["youtube", "instagram", "tiktok", "facebook"], shortsPerDay: 2, ...over }));
  for (const item of items) await queue.add(item);
  return queue;
};

describe("PublishQueue.releaseLegs", () => {
  it("stamps approval and leaves a fresh slot alone", async () => {
    const queue = await queueWith([testItem({ id: "a", publishAt: iso(-2), platformIds: ["instagram"] })]);
    const result = await queue.releaseLegs([{ id: "a", platform: "instagram" }], NOW);
    expect(result.approved).toBe(1);
    expect(result.moves).toEqual([]);
    const item = (await queue.get("a"))!;
    expect(item.platforms.instagram?.approvedAt).toBe(NOW.toISOString());
    expect(item.publishAt).toBe(iso(-2));
  });

  it("moves a single-leg post whose slot is too old to a future slot", async () => {
    const queue = await queueWith([testItem({ id: "a", publishAt: iso(-48), platformIds: ["instagram"] })]);
    const result = await queue.releaseLegs([{ id: "a", platform: "instagram" }], NOW);
    expect(result.moves).toHaveLength(1);
    const item = (await queue.get("a"))!;
    expect(item.publishAt).toBe(result.moves[0].publishAt);
    expect(new Date(item.publishAt).getTime()).toBeGreaterThan(NOW.getTime());
    expect(item.platforms.instagram?.approvedAt).toBeDefined();
    expect(queue.duePlatforms(item, NOW)).toEqual([]);
  });

  it("moves only the held leg of a post the other platforms already hold a time for", async () => {
    const queue = await queueWith([testItem({ id: "a", publishAt: iso(-48), platformIds: ["youtube", "instagram"] })]);
    const item = (await queue.get("a"))!;
    item.platforms.youtube = { status: "scheduled", postId: "yt1", attempts: 1, uploadedAt: iso(-60) };
    await queue.save();
    const result = await queue.releaseLegs([{ id: "a", platform: "instagram" }], NOW);
    const original = (await queue.get("a"))!;
    expect(original.publishAt).toBe(iso(-48));
    expect(Object.keys(original.platforms)).toEqual(["youtube"]);
    const moved = (await queue.list()).find((entry) => entry.id !== "a")!;
    expect(Object.keys(moved.platforms)).toEqual(["instagram"]);
    expect(moved.publishAt).toBe(result.moves[0].publishAt);
    expect(moved.title).toBe(original.title);
    expect(moved.platforms.instagram?.approvedAt).toBe(NOW.toISOString());
  });

  it("releases at most the daily cap and queues the rest for later days", async () => {
    const items = ["a", "b", "c", "d"].map((id, index) =>
      testItem({ id, publishAt: iso(-1 - index * 0.2), clipPath: `data/clips/outputs/job1/${id}.mp4`, platformIds: ["instagram"] })
    );
    const queue = await queueWith(items);
    const result = await queue.releaseLegs(items.map((item) => ({ id: item.id, platform: "instagram" as const })), NOW);
    expect(result.approved).toBe(4);
    expect(result.moves).toHaveLength(2);
    const due = (await queue.dueItems(NOW)).map((entry) => entry.item.id).sort();
    expect(due).toHaveLength(2);
    const later = (await queue.list()).filter((item) => new Date(item.publishAt).getTime() > NOW.getTime());
    expect(later).toHaveLength(2);
  });

  it("leaves a leg held when no slot can be found for it", async () => {
    const queue = await queueWith([testItem({ id: "a", publishAt: iso(-48), platformIds: ["instagram"] })], { bookingHorizonDays: 0 });
    const result = await queue.releaseLegs([{ id: "a", platform: "instagram" }], NOW);
    expect(result.approved).toBe(0);
    expect(result.skipped).toEqual([{ id: "a", platform: "instagram" }]);
    expect((await queue.get("a"))!.platforms.instagram?.approvedAt).toBeUndefined();
  });
});

describe("a held lead leg that is split off its post", () => {
  const MIRROR = { lead: "youtube" as const, targets: ["instagram", "facebook"] as Array<"instagram" | "facebook">, now: NOW };

  const splitScenario = async (over: { instagram?: object; facebook?: object; buffer?: boolean } = {}) => {
    const item = testItem({
      id: "a",
      publishAt: iso(-48),
      visibility: "public",
      platformIds: ["youtube", "instagram", "facebook"]
    });
    item.platforms.instagram = { status: "published", postId: "ig1", attempts: 1, ...over.instagram };
    item.platforms.facebook = { status: "published", postId: "fb1", attempts: 1, ...over.facebook };
    if (over.buffer) item.buffer = { status: "scheduled", attempts: 1, updateIds: ["u1"], scheduledAt: iso(-60) };
    item.failedSeenAt = iso(-30);
    const queue = await queueWith([item]);
    await queue.releaseLegs([{ id: "a", platform: "youtube" }], NOW);
    const items = await queue.list();
    return { queue, items, detached: items.find((entry) => entry.id !== "a")! };
  };

  it("is not mirrored back onto platforms the clip already went out on", async () => {
    const { items, detached } = await splitScenario();
    expect(Object.keys(detached.platforms)).toEqual(["youtube"]);
    expect(planMirror(items, { ...MIRROR, mode: "match" }).additions).toEqual([]);
    expect(planMirror(items, { ...MIRROR, mode: "shuffle", seed: 3 }).newItems).toEqual([]);
  });

  it("is not mirrored onto a platform where the clip is still pending or scheduled", async () => {
    const { items } = await splitScenario({ instagram: { status: "pending", postId: undefined, attempts: 0 }, facebook: { status: "scheduled", postId: "fb1" } });
    expect(planMirror(items, { ...MIRROR, mode: "match" }).additions).toEqual([]);
    expect(planMirror(items, { ...MIRROR, mode: "shuffle", seed: 3 }).newItems).toEqual([]);
  });

  it("still mirrors a clip that is on no other platform", async () => {
    const queue = await queueWith([
      testItem({ id: "fresh", publishAt: iso(30), visibility: "public", clipPath: "data/clips/outputs/job1/fresh.mp4", platformIds: ["youtube"] })
    ]);
    const plan = planMirror(await queue.list(), { ...MIRROR, mode: "match" });
    expect(plan.additions).toEqual([
      { itemId: "fresh", platform: "instagram" },
      { itemId: "fresh", platform: "facebook" }
    ]);
  });

  it("mirrors onto a platform where the clip's only leg failed", async () => {
    const { items } = await splitScenario({ instagram: { status: "failed", postId: undefined, attempts: 3, error: "boom" } });
    expect(planMirror(items, { ...MIRROR, mode: "match" }).additions).toEqual([{ itemId: items.find((entry) => entry.id !== "a")!.id, platform: "instagram" }]);
  });

  it("carries no delivery state into the copy", async () => {
    const { detached } = await splitScenario({ buffer: true });
    expect(detached.buffer).toBeUndefined();
    expect(detached.failedSeenAt).toBeUndefined();
    expect(detached.clipPath).toBe("data/clips/outputs/job1/export-a.mp4");
    expect(detached.title).toBe("Test clip");
  });
});
