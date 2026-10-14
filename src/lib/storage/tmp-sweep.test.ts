import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lockFilePath } from "@/lib/storage/file-lock";
import { sweepStaleTmpFiles } from "@/lib/storage/tmp-sweep";

const HOUR = 3_600_000;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "tmp-sweep-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function touch(file: string, ageMs: number, content = "") {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
  const when = new Date(Date.now() - ageMs);
  await utimes(file, when, when);
}

async function names(dir = root) {
  return (await readdir(dir)).sort();
}

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
  await new Promise((resolve) => child.once("exit", resolve));
  return child.pid!;
}

describe("sweepStaleTmpFiles", () => {
  it("removes temporary files older than an hour and keeps newer ones", async () => {
    await touch(path.join(root, "publish-queue.json.41668.1790854297264.tmp"), 3 * HOUR);
    await touch(path.join(root, "threads-queue.json.1.abc.tmp"), 2 * HOUR);
    await touch(path.join(root, "publish-queue.json.2.fresh.tmp"), 5 * 60_000);

    const result = await sweepStaleTmpFiles(root);

    expect(await names()).toEqual(["publish-queue.json.2.fresh.tmp"]);
    expect(result.removed).toHaveLength(2);
  });

  it("never touches files that are not temporary files", async () => {
    await touch(path.join(root, "publish-queue.json"), 9 * HOUR, "[]");
    await touch(path.join(root, "publish-queue.backup-2026-07-28.json"), 9 * HOUR, "[]");
    await touch(path.join(root, "notes.tmp.txt"), 9 * HOUR);
    await touch(path.join(root, "download.partial"), 9 * HOUR);

    const result = await sweepStaleTmpFiles(root);

    expect(await names()).toEqual(["download.partial", "notes.tmp.txt", "publish-queue.backup-2026-07-28.json", "publish-queue.json"]);
    expect(result.removed).toEqual([]);
  });

  it("reaches temporary files in sub-folders", async () => {
    await touch(path.join(root, "automations", "pipeline-outcome.json.24136.9414.tmp"), 30 * HOUR);
    await touch(path.join(root, "longform", "projects.json.24136.1791214299069.tmp"), 30 * HOUR);

    await sweepStaleTmpFiles(root);

    expect(await names(path.join(root, "automations"))).toEqual([]);
    expect(await names(path.join(root, "longform"))).toEqual([]);
  });

  it("leaves a temporary file alone while a live lock is held on the file it belongs to", async () => {
    await touch(path.join(root, "publish-queue.json.41668.1790854297264.tmp"), 3 * HOUR);
    await writeFile(
      lockFilePath(path.join(root, "publish-queue.json")),
      JSON.stringify({ pid: process.pid, token: "t", acquiredAt: new Date().toISOString() })
    );

    const result = await sweepStaleTmpFiles(root);

    expect(await names()).toContain("publish-queue.json.41668.1790854297264.tmp");
    expect(result.removed).toEqual([]);
    expect(result.heldByLock).toHaveLength(1);
  });

  it("sweeps once the lock belongs to a process that is gone", async () => {
    await touch(path.join(root, "publish-queue.json.41668.1790854297264.tmp"), 3 * HOUR);
    await writeFile(
      lockFilePath(path.join(root, "publish-queue.json")),
      JSON.stringify({ pid: await deadPid(), token: "t", acquiredAt: new Date().toISOString() })
    );

    const result = await sweepStaleTmpFiles(root);

    expect(result.removed).toHaveLength(1);
  });

  it("does nothing for a folder that does not exist", async () => {
    expect((await sweepStaleTmpFiles(path.join(root, "missing"))).removed).toEqual([]);
  });

  it("uses the age it is given", async () => {
    await touch(path.join(root, "a.json.1.x.tmp"), 10 * 60_000);
    const result = await sweepStaleTmpFiles(root, { olderThanMs: 5 * 60_000 });
    expect(result.removed).toHaveLength(1);
  });
});
