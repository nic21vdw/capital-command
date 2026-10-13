import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { directorySizeBytes } from "@/lib/disk/size";
import { createDataSizeCache, readDiskUsage } from "@/lib/disk/usage";

const GB = 1024 ** 3;
const created: string[] = [];

async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "disk-usage-test-"));
  created.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("directorySizeBytes", () => {
  it("adds up every file in the tree", async () => {
    const dir = await tempDir();
    await mkdir(path.join(dir, "a", "b"), { recursive: true });
    await writeFile(path.join(dir, "one.bin"), Buffer.alloc(1000));
    await writeFile(path.join(dir, "a", "two.bin"), Buffer.alloc(2000));
    await writeFile(path.join(dir, "a", "b", "three.bin"), Buffer.alloc(300));

    expect(await directorySizeBytes(dir)).toBe(3300);
  });

  it("is the size of a single file when given one", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "one.bin");
    await writeFile(file, Buffer.alloc(1234));

    expect(await directorySizeBytes(file)).toBe(1234);
  });

  it("is zero for a folder that does not exist", async () => {
    const dir = await tempDir();

    expect(await directorySizeBytes(path.join(dir, "missing"))).toBe(0);
  });
});

describe("createDataSizeCache", () => {
  it("walks once and serves the cached size for ten minutes", async () => {
    const clock = { now: 1_000_000 };
    const measure = vi.fn(async () => 660 * GB);
    const cache = createDataSizeCache({ measure, now: () => clock.now });

    expect(cache.read()).toMatchObject({ bytes: null, computing: true });
    await cache.idle();
    expect(cache.read()).toMatchObject({ bytes: 660 * GB, computing: false });

    clock.now += 9 * 60_000;
    expect(cache.read().bytes).toBe(660 * GB);
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it("refreshes in the background after ten minutes while still answering with the old size", async () => {
    const clock = { now: 1_000_000 };
    let size = 600 * GB;
    const measure = vi.fn(async () => size);
    const cache = createDataSizeCache({ measure, now: () => clock.now });
    cache.read();
    await cache.idle();

    clock.now += 10 * 60_000 + 1;
    size = 640 * GB;
    expect(cache.read()).toMatchObject({ bytes: 600 * GB, computing: true });
    await cache.idle();

    expect(cache.read().bytes).toBe(640 * GB);
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it("shares one walk between simultaneous readers", async () => {
    const measure = vi.fn(async () => 5);
    const cache = createDataSizeCache({ measure });
    cache.read();
    cache.read();
    cache.read();
    await cache.idle();

    expect(measure).toHaveBeenCalledTimes(1);
  });

  it("keeps the last good size when a walk fails", async () => {
    const clock = { now: 0 };
    const measure = vi.fn<() => Promise<number>>().mockResolvedValueOnce(100).mockRejectedValueOnce(new Error("EBUSY"));
    const cache = createDataSizeCache({ measure, now: () => clock.now });
    cache.read();
    await cache.idle();

    clock.now += 11 * 60_000;
    cache.read();
    await cache.idle();

    expect(cache.read()).toMatchObject({ bytes: 100, computing: false });
  });
});

describe("readDiskUsage", () => {
  it("flags the drive as low under the render threshold and reports the data folder size", async () => {
    const usage = await readDiskUsage({
      space: async () => ({ freeBytes: 30 * GB, totalBytes: 500 * GB }),
      minBytes: 40 * GB,
      dataSize: { read: () => ({ bytes: 660 * GB, measuredAt: 1, computing: false }) }
    });

    expect(usage).toMatchObject({
      freeBytes: 30 * GB,
      totalBytes: 500 * GB,
      minFreeBytes: 40 * GB,
      low: true,
      dataBytes: 660 * GB,
      dataComputing: false
    });
  });

  it("is not low with room to spare, and says so while the data folder is still being measured", async () => {
    const usage = await readDiskUsage({
      space: async () => ({ freeBytes: 200 * GB, totalBytes: 500 * GB }),
      minBytes: 40 * GB,
      dataSize: { read: () => ({ bytes: null, measuredAt: null, computing: true }) }
    });

    expect(usage.low).toBe(false);
    expect(usage.dataBytes).toBeNull();
    expect(usage.dataComputing).toBe(true);
  });
});
