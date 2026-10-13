import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileLockTimeoutError, isLockHeld, lockFilePath, withFileLock } from "@/lib/storage/file-lock";

let dir: string;
let target: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "file-lock-"));
  target = path.join(dir, "queue.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
  await new Promise((resolve) => child.once("exit", resolve));
  return child.pid!;
}

describe("withFileLock", () => {
  it("records the holder's pid while the work runs and removes the lock afterwards", async () => {
    let held: { pid: number } | null = null;
    await withFileLock(target, async () => {
      held = JSON.parse(await readFile(lockFilePath(target), "utf8"));
    });
    expect(held!.pid).toBe(process.pid);
    expect(await readdir(dir)).toEqual([]);
  });

  it("never lets two holders overlap, in one process", async () => {
    let inside = 0;
    let overlapped = false;
    await Promise.all(
      Array.from({ length: 12 }, () =>
        withFileLock(target, async () => {
          inside += 1;
          if (inside > 1) overlapped = true;
          await new Promise((resolve) => setTimeout(resolve, 5));
          inside -= 1;
        })
      )
    );
    expect(overlapped).toBe(false);
  });

  it("releases the lock when the work throws", async () => {
    await expect(
      withFileLock(target, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(await readdir(dir)).toEqual([]);
  });

  it("returns what the work returns", async () => {
    expect(await withFileLock(target, async () => 42)).toBe(42);
  });

  it("takes over a lock whose holder is no longer running", async () => {
    const pid = await deadPid();
    await writeFile(lockFilePath(target), JSON.stringify({ pid, token: "gone", acquiredAt: new Date().toISOString() }));
    let ran = false;
    await withFileLock(target, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(await readdir(dir)).toEqual([]);
  });

  it("takes over a lock that is older than the stale timeout even if the pid is alive", async () => {
    await writeFile(
      lockFilePath(target),
      JSON.stringify({ pid: process.pid, token: "old", acquiredAt: new Date(Date.now() - 60_000).toISOString() })
    );
    let ran = false;
    await withFileLock(target, async () => {
      ran = true;
    }, { staleMs: 5_000 });
    expect(ran).toBe(true);
  });

  it("takes over an unreadable lock file once it is older than the stale timeout", async () => {
    await writeFile(lockFilePath(target), "");
    const old = new Date(Date.now() - 60_000);
    await utimes(lockFilePath(target), old, old);
    let ran = false;
    await withFileLock(target, async () => {
      ran = true;
    }, { staleMs: 5_000 });
    expect(ran).toBe(true);
  });

  it("waits for a live holder and times out with an error that names the holder", async () => {
    await writeFile(
      lockFilePath(target),
      JSON.stringify({ pid: process.pid, token: "busy", acquiredAt: new Date().toISOString() })
    );
    let ran = false;
    const attempt = withFileLock(target, async () => {
      ran = true;
    }, { timeoutMs: 150, retryMs: 10 });
    await expect(attempt).rejects.toBeInstanceOf(FileLockTimeoutError);
    await expect(attempt).rejects.toThrow(String(process.pid));
    expect(ran).toBe(false);
    expect((await stat(lockFilePath(target))).isFile()).toBe(true);
  });

  it("does not remove a lock another holder took over while the work ran", async () => {
    await withFileLock(target, async () => {
      await writeFile(
        lockFilePath(target),
        JSON.stringify({ pid: process.pid, token: "someone-else", acquiredAt: new Date().toISOString() })
      );
    });
    expect(JSON.parse(await readFile(lockFilePath(target), "utf8")).token).toBe("someone-else");
  });
});

describe("isLockHeld", () => {
  it("is true for a fresh lock owned by a running process", async () => {
    await writeFile(
      lockFilePath(target),
      JSON.stringify({ pid: process.pid, token: "t", acquiredAt: new Date().toISOString() })
    );
    expect(await isLockHeld(target)).toBe(true);
  });

  it("is false when there is no lock, the holder is gone, or the lock is stale", async () => {
    expect(await isLockHeld(target)).toBe(false);

    await writeFile(
      lockFilePath(target),
      JSON.stringify({ pid: await deadPid(), token: "t", acquiredAt: new Date().toISOString() })
    );
    expect(await isLockHeld(target)).toBe(false);

    await writeFile(
      lockFilePath(target),
      JSON.stringify({ pid: process.pid, token: "t", acquiredAt: new Date(Date.now() - 600_000).toISOString() })
    );
    expect(await isLockHeld(target)).toBe(false);
  });
});
