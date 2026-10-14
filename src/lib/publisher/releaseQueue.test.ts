import { describe, expect, it } from "vitest";
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
