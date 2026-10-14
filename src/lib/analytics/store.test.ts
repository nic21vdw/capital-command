import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { metricsFile, readMetrics, updateMetrics } from "@/lib/analytics/store";
import { emptyStore, type PostRecord } from "@/lib/analytics/types";
import { withFileLock } from "@/lib/storage/file-lock";

function post(id: string, overrides: Partial<PostRecord> = {}): PostRecord {
  return {
    key: `youtube:${id}`,
    platform: "youtube",
    accountId: "youtube-primary",
    postId: id,
    itemId: `item-${id}`,
    format: "video",
    title: `Title ${id}`,
    caption: "",
    publishedAt: "2026-10-01T15:00:00.000Z",
    status: "ok",
    latest: null,
    history: [],
    misses: 0,
    ...overrides
  };
}

beforeEach(async () => {
  await rm(path.dirname(metricsFile()), { recursive: true, force: true });
});

describe("the analytics store", () => {
  it("lives at data/analytics/metrics.json and reads as empty before anything is synced", async () => {
    expect(metricsFile().replace(/\\/g, "/")).toMatch(/\/analytics\/metrics\.json$/);
    expect(await readMetrics()).toEqual(emptyStore());
  });

  it("saves what an update changes, compactly, and reads it back", async () => {
    await updateMetrics((store) => {
      store.posts["youtube:a"] = post("a");
    });

    const raw = await readFile(metricsFile(), "utf8");
    expect(raw).not.toContain("\n");
    expect((await readMetrics()).posts["youtube:a"].title).toBe("Title a");
  });

  it("applies updates one after another, so two writers cannot lose each other's change", async () => {
    await Promise.all(
      ["a", "b", "c", "d"].map((id) =>
        updateMetrics(async (store) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          store.posts[`youtube:${id}`] = post(id);
        })
      )
    );

    expect(Object.keys((await readMetrics()).posts).sort()).toEqual(["youtube:a", "youtube:b", "youtube:c", "youtube:d"]);
  });

  it("waits for another process's lock on the file before it writes", async () => {
    await updateMetrics((store) => {
      store.posts["youtube:a"] = post("a");
    });
    const order: string[] = [];

    const holder = withFileLock(metricsFile(), async () => {
      order.push("lock held");
      await new Promise((resolve) => setTimeout(resolve, 120));
      order.push("lock released");
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const writer = updateMetrics((store) => {
      order.push("updated");
      store.posts["youtube:b"] = post("b");
    });
    await Promise.all([holder, writer]);

    expect(order).toEqual(["lock held", "lock released", "updated"]);
  });

  it("returns whatever the update function returns", async () => {
    await expect(updateMetrics(() => 42)).resolves.toBe(42);
  });

  it("sees a change another process made to the file", async () => {
    await updateMetrics((store) => {
      store.posts["youtube:a"] = post("a");
    });
    await readMetrics();
    const other = emptyStore();
    other.posts["youtube:zzzzzzzzzzzzzz"] = post("zzzzzzzzzzzzzz", { title: "Written elsewhere" });
    await writeFile(metricsFile(), JSON.stringify(other));

    expect(Object.keys((await readMetrics()).posts)).toEqual(["youtube:zzzzzzzzzzzzzz"]);
  });

  it("refuses to read a corrupt file and leaves it untouched, so the next write cannot replace real history with nothing", async () => {
    await mkdir(path.dirname(metricsFile()), { recursive: true });
    await writeFile(metricsFile(), "{ not json");

    await expect(readMetrics()).rejects.toThrow(/metrics\.json/);
    await expect(updateMetrics((store) => void (store.posts["youtube:a"] = post("a")))).rejects.toThrow(/metrics\.json/);
    expect(await readFile(metricsFile(), "utf8")).toBe("{ not json");
  });

  it("drops entries that are not posts instead of failing on them", async () => {
    await mkdir(path.dirname(metricsFile()), { recursive: true });
    await writeFile(
      metricsFile(),
      JSON.stringify({ version: 1, posts: { "youtube:a": post("a"), broken: { title: 5 }, nothing: null }, accounts: {}, sync: {} })
    );

    const store = await readMetrics();

    expect(Object.keys(store.posts)).toEqual(["youtube:a"]);
    expect(store.sync).toEqual(emptyStore().sync);
  });
});
