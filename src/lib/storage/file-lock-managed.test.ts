import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileQueueStore } from "@/lib/publisher/store";
import { isLockHeld, lockFilePath, withFileLock } from "./file-lock";

describe("managed queue transaction lock", () => {
  it("ordinary queue saves also protect their live holder against elapsed-time eviction", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "queue-lock-live-synthetic-"));
    const target = path.join(root, "synthetic.json");
    const store = new FileQueueStore(target);
    await store.withLock(async () => {
      const file = lockFilePath(target);
      const record = JSON.parse(await readFile(file, "utf8"));
      expect(record.reclaimOnlyWhenDead).toBe(true);
      record.acquiredAt = "2000-01-01T00:00:00.000Z";
      await writeFile(file, JSON.stringify(record));
      expect(await isLockHeld(target, 1)).toBe(true);
    });
  });
  it("a strict acquirer cannot evict a live legacy holder merely for age", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "managed-lock-legacy-synthetic-"));
    const target = path.join(root, "synthetic.json");
    await writeFile(lockFilePath(target), JSON.stringify({
      pid: process.pid, token: "synthetic-live-legacy-holder", acquiredAt: "2000-01-01T00:00:00.000Z"
    }));
    await expect(withFileLock(target, async () => "must not enter", {
      reclaimLiveHolder: false, timeoutMs: 30, retryMs: 1, staleMs: 1
    })).rejects.toThrow(/Timed out/);
  });
  it("writes strict ownership and an ordinary writer cannot evict a live holder merely for age", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "managed-lock-synthetic-"));
    const target = path.join(root, "synthetic.json");
    await withFileLock(target, async () => {
      const file = lockFilePath(target);
      const record = JSON.parse(await readFile(file, "utf8"));
      expect(record.reclaimOnlyWhenDead).toBe(true);
      record.acquiredAt = "2000-01-01T00:00:00.000Z";
      await writeFile(file, JSON.stringify(record));
      expect(await isLockHeld(target, 1)).toBe(true);
    }, { reclaimLiveHolder: false });
    // A separately created old live lock represents an independent holder,
    // avoiding the same-context recursive-lock protection in withFileLock.
    await writeFile(lockFilePath(target), JSON.stringify({ pid: process.pid, token: "synthetic-independent-holder", acquiredAt: "2000-01-01T00:00:00.000Z", reclaimOnlyWhenDead: true }));
    await expect(withFileLock(target, async () => "must not enter", { timeoutMs: 30, retryMs: 1, staleMs: 1 })).rejects.toThrow(/Timed out/);
  });
});
