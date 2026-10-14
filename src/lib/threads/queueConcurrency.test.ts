import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ThreadsQueueItem } from "@/lib/threads/types";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "threads-concurrency-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function runWriter(name: string, barrier: string, count: number): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", path.join(process.cwd(), "src", "lib", "threads", "queueWriterChild.ts"), name, barrier, String(count)],
      { cwd: process.cwd(), env: { ...process.env, CAPITAL_COMMAND_DATA_DIR: dir }, stdio: ["ignore", "pipe", "pipe"] }
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, output }));
  });
}

describe("two processes mutating the Threads queue", () => {
  it("every addition from both survives", async () => {
    const barrier = path.join(dir, "barrier");
    await mkdir(barrier);
    const count = 25;

    const [a, b] = await Promise.all([runWriter("a", barrier, count), runWriter("b", barrier, count)]);

    expect(a.output).toBe("");
    expect(b.output).toBe("");
    expect([a.code, b.code]).toEqual([0, 0]);
    const saved = JSON.parse(await readFile(path.join(dir, "threads-queue.json"), "utf8")) as ThreadsQueueItem[];
    expect(saved).toHaveLength(count * 2);
    expect(new Set(saved.map((entry) => entry.id)).size).toBe(count * 2);
    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp") || name.endsWith(".lock"))).toEqual([]);
  }, 90_000);
});
