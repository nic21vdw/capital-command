import { describe, expect, it } from "vitest";
import { mergeById, snapshotById } from "@/lib/publisher/queueMerge";
import { testItem } from "@/lib/publisher/test-helpers";
import type { QueueItem } from "@/lib/publisher/types";

const T1 = "2026-10-01T10:00:00.000Z";
const T2 = "2026-10-01T10:05:00.000Z";
const T3 = "2026-10-01T10:10:00.000Z";

const byId = (items: QueueItem[]) => new Map(items.map((item) => [item.id, item]));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function setup(...seed: QueueItem[]) {
  const base = snapshotById(seed);
  return { base, mine: byId(clone(seed)), theirs: byId(clone(seed)) };
}

describe("mergeById", () => {
  it("keeps an item added on either side", () => {
    const seed = testItem({ id: "seed" });
    const { base, mine, theirs } = setup(seed);
    mine.set("mine", testItem({ id: "mine" }));
    theirs.set("theirs", testItem({ id: "theirs" }));

    expect([...mergeById(base, mine, theirs).keys()].sort()).toEqual(["mine", "seed", "theirs"]);
  });

  it("applies a change made only by the other writer", () => {
    const { base, mine, theirs } = setup(testItem({ id: "a", caption: "before" }));
    theirs.get("a")!.caption = "from the runner";

    expect(mergeById(base, mine, theirs).get("a")!.caption).toBe("from the runner");
  });

  it("applies a change made only by this writer", () => {
    const { base, mine, theirs } = setup(testItem({ id: "a", caption: "before" }));
    mine.get("a")!.caption = "mine";

    expect(mergeById(base, mine, theirs).get("a")!.caption).toBe("mine");
  });

  it("drops an item the other writer deleted when this one did not touch it", () => {
    const { base, mine, theirs } = setup(testItem({ id: "a" }), testItem({ id: "b" }));
    theirs.delete("a");

    expect([...mergeById(base, mine, theirs).keys()]).toEqual(["b"]);
  });

  it("keeps an item deleted here deleted, even if the other writer edited it", () => {
    const { base, mine, theirs } = setup(testItem({ id: "a" }), testItem({ id: "b" }));
    mine.delete("a");
    theirs.get("a")!.caption = "edited elsewhere";

    expect([...mergeById(base, mine, theirs).keys()]).toEqual(["b"]);
  });

  it("keeps an item deleted elsewhere deleted, even if this writer edited it", () => {
    const { base, mine, theirs } = setup(testItem({ id: "a" }), testItem({ id: "b" }));
    mine.get("a")!.caption = "edited here";
    theirs.delete("a");

    expect([...mergeById(base, mine, theirs).keys()]).toEqual(["b"]);
  });

  it("keeps both changes when two writers edit different fields of one item", () => {
    const { base, mine, theirs } = setup(testItem({ id: "a", caption: "before", title: "T" }));
    mine.get("a")!.caption = "new caption";
    theirs.get("a")!.publishAt = "2026-12-01T00:00:00.000Z";

    const merged = mergeById(base, mine, theirs).get("a")!;
    expect(merged.caption).toBe("new caption");
    expect(merged.publishAt).toBe("2026-12-01T00:00:00.000Z");
    expect(merged.title).toBe("T");
  });

  it("keeps both changes when two writers touch different platforms of one item", () => {
    const { base, mine, theirs } = setup(testItem({ id: "a" }));
    mine.get("a")!.platforms.youtube!.claimedAt = T1;
    theirs.get("a")!.platforms.instagram!.status = "published";

    const merged = mergeById(base, mine, theirs).get("a")!;
    expect(merged.platforms.youtube!.claimedAt).toBe(T1);
    expect(merged.platforms.instagram!.status).toBe("published");
  });

  it("lets the newer updatedAt win when both writers changed the same field", () => {
    const { base, mine, theirs } = setup(testItem({ id: "a", caption: "before" }));
    mine.get("a")!.caption = "mine";
    mine.get("a")!.updatedAt = T3;
    theirs.get("a")!.caption = "theirs";
    theirs.get("a")!.updatedAt = T2;
    expect(mergeById(base, mine, theirs).get("a")!.caption).toBe("mine");

    theirs.get("a")!.updatedAt = T3;
    mine.get("a")!.updatedAt = T2;
    expect(mergeById(base, mine, theirs).get("a")!.caption).toBe("theirs");
  });

  it("stamps the merged item with the newer of the two stamps", () => {
    const { base, mine, theirs } = setup(testItem({ id: "a", caption: "before" }));
    mine.get("a")!.caption = "mine";
    mine.get("a")!.updatedAt = T2;
    theirs.get("a")!.publishAt = "2026-12-01T00:00:00.000Z";
    theirs.get("a")!.updatedAt = T3;

    expect(mergeById(base, mine, theirs).get("a")!.updatedAt).toBe(T3);
  });

  it("merges an id that both writers added, with the newer one winning a clash", () => {
    const { base, mine, theirs } = setup();
    mine.set("n", { ...testItem({ id: "n", caption: "mine" }), updatedAt: T1 });
    theirs.set("n", { ...testItem({ id: "n", caption: "theirs" }), updatedAt: T2 });

    expect(mergeById(base, mine, theirs).get("n")!.caption).toBe("theirs");
  });

  it("returns this writer's own object when nothing else moved, so held references stay live", () => {
    const { base, mine, theirs } = setup(testItem({ id: "a" }));
    mine.get("a")!.caption = "mine";

    expect(mergeById(base, mine, theirs).get("a")).toBe(mine.get("a"));
  });
});

describe("mergeById when two writers changed the same platform leg", () => {
  const published = { status: "published" as const, attempts: 0, postId: "yt-1", publishedAt: T1, uploadedAt: T1 };

  it("keeps a published leg and its post id even when the other writer's claim is newer", () => {
    const { base, mine, theirs } = setup(testItem({ id: "a" }));
    theirs.get("a")!.platforms.youtube = { ...published };
    theirs.get("a")!.updatedAt = T1;
    mine.get("a")!.platforms.youtube!.claimedAt = T3;
    mine.get("a")!.updatedAt = T3;

    const leg = mergeById(base, mine, theirs).get("a")!.platforms.youtube!;
    expect(leg.status).toBe("published");
    expect(leg.postId).toBe("yt-1");
    expect(leg.publishedAt).toBe(T1);
  });

  it("keeps this writer's published leg when the other writer's pending leg is newer", () => {
    const { base, mine, theirs } = setup(testItem({ id: "a" }));
    mine.get("a")!.platforms.youtube = { ...published };
    mine.get("a")!.updatedAt = T1;
    theirs.get("a")!.platforms.youtube!.claimedAt = T3;
    theirs.get("a")!.updatedAt = T3;

    const leg = mergeById(base, mine, theirs).get("a")!.platforms.youtube!;
    expect(leg.status).toBe("published");
    expect(leg.postId).toBe("yt-1");
  });

  it("treats a leg with only a post id or only a published time as published", () => {
    for (const marker of [{ postId: "ig-9" }, { publishedAt: T1 }]) {
      const { base, mine, theirs } = setup(testItem({ id: "a" }));
      theirs.get("a")!.platforms.instagram = { status: "uploaded", attempts: 0, ...marker };
      mine.get("a")!.platforms.instagram!.claimedAt = T3;
      mine.get("a")!.updatedAt = T3;

      const leg = mergeById(base, mine, theirs).get("a")!.platforms.instagram!;
      expect({ postId: leg.postId, publishedAt: leg.publishedAt }).toEqual({ postId: undefined, publishedAt: undefined, ...marker });
    }
  });

  it("never drops a post id or publish time when both legs carry one", () => {
    const { base, mine, theirs } = setup(testItem({ id: "a" }));
    mine.get("a")!.platforms.youtube = { status: "uploaded", attempts: 0, postId: "yt-1" };
    mine.get("a")!.updatedAt = T3;
    theirs.get("a")!.platforms.youtube = { status: "published", attempts: 0, publishedAt: T2 };
    theirs.get("a")!.updatedAt = T1;

    const leg = mergeById(base, mine, theirs).get("a")!.platforms.youtube!;
    expect(leg.status).toBe("published");
    expect(leg.postId).toBe("yt-1");
    expect(leg.publishedAt).toBe(T2);
  });

  it("keeps the higher attempt count when a failed leg meets a pending one", () => {
    const { base, mine, theirs } = setup(testItem({ id: "a" }));
    theirs.get("a")!.platforms.tiktok = { status: "failed", attempts: 3, error: "rejected" };
    theirs.get("a")!.updatedAt = T1;
    mine.get("a")!.platforms.tiktok!.claimedAt = T3;
    mine.get("a")!.updatedAt = T3;

    const leg = mergeById(base, mine, theirs).get("a")!.platforms.tiktok!;
    expect(leg.status).toBe("failed");
    expect(leg.attempts).toBe(3);
  });

  it("keeps the higher attempt count between two retrying legs, and the newer one on a tie", () => {
    const { base, mine, theirs } = setup(testItem({ id: "a" }));
    mine.get("a")!.platforms.tiktok = { status: "pending", attempts: 1, error: "mine" };
    mine.get("a")!.updatedAt = T3;
    theirs.get("a")!.platforms.tiktok = { status: "pending", attempts: 2, error: "theirs" };
    theirs.get("a")!.updatedAt = T1;
    expect(mergeById(base, mine, theirs).get("a")!.platforms.tiktok!.error).toBe("theirs");

    theirs.get("a")!.platforms.tiktok!.attempts = 1;
    expect(mergeById(base, mine, theirs).get("a")!.platforms.tiktok!.error).toBe("mine");
  });

  it("leaves a leg only one writer touched alone", () => {
    const { base, mine, theirs } = setup(testItem({ id: "a" }));
    theirs.get("a")!.platforms.youtube = { ...published };
    mine.get("a")!.platforms.tiktok!.claimedAt = T3;

    const merged = mergeById(base, mine, theirs).get("a")!;
    expect(merged.platforms.youtube!.postId).toBe("yt-1");
    expect(merged.platforms.tiktok!.claimedAt).toBe(T3);
  });

  it("protects a Buffer delivery that already has update ids", () => {
    const { base, mine, theirs } = setup(testItem({ id: "a" }));
    theirs.get("a")!.buffer = { status: "scheduled", attempts: 0, updateIds: ["u1"] };
    theirs.get("a")!.updatedAt = T1;
    mine.get("a")!.buffer = { status: "pending", attempts: 0, claimedAt: T3 };
    mine.get("a")!.updatedAt = T3;

    expect(mergeById(base, mine, theirs).get("a")!.buffer!.updateIds).toEqual(["u1"]);
  });
});
