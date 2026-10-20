import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isLockHeld, lockFilePath, withFileLock } from "./file-lock";

describe("managed queue transaction lock", () => {
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
