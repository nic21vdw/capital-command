import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    unlink: async (file: Parameters<typeof actual.unlink>[0]) => {
      if (String(file).endsWith(".lock")) throw Object.assign(new Error("resource busy"), { code: "EBUSY" });
      return actual.unlink(file);
    }
  };
});

const { FileLockTimeoutError, lockFilePath, withFileLock } = await import("@/lib/storage/file-lock");

let dir: string;
let target: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "file-lock-stuck-"));
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

describe("withFileLock with a stale lock that cannot be removed", () => {
  it("times out instead of spinning forever", async () => {
    await writeFile(
      lockFilePath(target),
      JSON.stringify({ pid: await deadPid(), token: "gone", acquiredAt: new Date().toISOString() })
    );
    let ran = false;
    const attempt = withFileLock(target, async () => {
      ran = true;
    }, { timeoutMs: 300, retryMs: 10 });
    await expect(attempt).rejects.toBeInstanceOf(FileLockTimeoutError);
    expect(ran).toBe(false);
  }, 5_000);
});
