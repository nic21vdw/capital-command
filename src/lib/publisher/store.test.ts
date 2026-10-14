import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, default: actual, rename: vi.fn(actual.rename) };
});

import * as fsp from "node:fs/promises";
import { FileQueueStore, QUEUE_LOCK_TIMEOUT_MS } from "@/lib/publisher/store";
import { DEFAULT_LOCK_STALE_MS, DEFAULT_LOCK_TIMEOUT_MS } from "@/lib/storage/file-lock";

const rename = vi.mocked(fsp.rename);
const realRename = rename.getMockImplementation()!;

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated`), { code });
}

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "queue-store-"));
  file = path.join(dir, "publish-queue.json");
  rename.mockReset().mockImplementation(realRename);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FileQueueStore.save", () => {
  it("replaces the queue through a temporary file", async () => {
    const store = new FileQueueStore(file);
    await store.save("[1]");
    await store.save("[1,2]");
    expect(await readFile(file, "utf8")).toBe("[1,2]");
    expect(await readdir(dir)).toEqual(["publish-queue.json"]);
  });

  it("leaves the queue exactly as it was when the swap keeps failing with EPERM", async () => {
    await writeFile(file, '[{"id":"a"},{"id":"b"}]', "utf8");
    rename.mockRejectedValue(errno("EPERM"));

    await expect(new FileQueueStore(file, { backoffMs: 1, maxBackoffMs: 1 }).save("[]")).rejects.toMatchObject({ code: "EPERM" });

    expect(await readFile(file, "utf8")).toBe('[{"id":"a"},{"id":"b"}]');
    expect(await readdir(dir)).toEqual(["publish-queue.json"]);
  });

  it("keeps trying about forty times before giving up on a file a scanner is holding", async () => {
    rename.mockRejectedValue(errno("EBUSY"));
    const store = new FileQueueStore(file, { backoffMs: 1, maxBackoffMs: 1 });

    await expect(store.save("[]")).rejects.toMatchObject({ code: "EBUSY" });

    expect(rename.mock.calls.length).toBeGreaterThanOrEqual(40);
  });

  it("gets a save through a file that stays busy for thirty-five attempts", async () => {
    let busy = 35;
    rename.mockImplementation(async (...args: Parameters<typeof realRename>) => {
      if (busy-- > 0) throw errno("EPERM");
      return realRename(...args);
    });

    await new FileQueueStore(file, { backoffMs: 1, maxBackoffMs: 1 }).save('[{"id":"published"}]');

    expect(await readFile(file, "utf8")).toBe('[{"id":"published"}]');
  });

  it("waits longer for the queue lock than the lock takes to go stale", () => {
    expect(DEFAULT_LOCK_TIMEOUT_MS).toBeGreaterThan(DEFAULT_LOCK_STALE_MS);
    expect(QUEUE_LOCK_TIMEOUT_MS).toBeGreaterThan(DEFAULT_LOCK_STALE_MS);
  });

  it("leaves no temporary file when the swap fails for any other reason", async () => {
    await writeFile(file, "[1]", "utf8");
    rename.mockRejectedValue(errno("ENOSPC"));

    await expect(new FileQueueStore(file).save("[2]")).rejects.toMatchObject({ code: "ENOSPC" });

    expect(await readFile(file, "utf8")).toBe("[1]");
    expect(await readdir(dir)).toEqual(["publish-queue.json"]);
  });
});
