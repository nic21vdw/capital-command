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
