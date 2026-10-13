import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PublishQueue } from "@/lib/publisher/queue";
import { FileQueueStore } from "@/lib/publisher/store";
import { testConfig, testItem } from "@/lib/publisher/test-helpers";
import type { QueueItem } from "@/lib/publisher/types";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "queue-concurrency-"));
  file = path.join(dir, "publish-queue.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const NOW = new Date("2026-10-01T10:00:00.000Z");

function open() {
  return new PublishQueue(new FileQueueStore(file), testConfig());
}

async function onDisk(): Promise<QueueItem[]> {
  return JSON.parse(await readFile(file, "utf8")) as QueueItem[];
}

describe("two writers on one publish queue file", () => {
  it("keeps an item another writer added while this one held a stale copy", async () => {
    const server = open();
    const cli = open();
    await server.add(testItem({ id: "seed" }));
    const held = (await cli.get("seed"))!;

    await server.add(testItem({ id: "from-server", publishAt: "2026-07-11T10:00:00.000Z" }));
    await cli.claim(held, "youtube", NOW);

    const ids = (await onDisk()).map((item) => item.id).sort();
    expect(ids).toEqual(["from-server", "seed"]);
    expect((await onDisk()).find((item) => item.id === "seed")!.platforms.youtube!.claimedAt).toBe(NOW.toISOString());
  });

  it("keeps a field another writer changed on the same item", async () => {
    const server = open();
    const cli = open();
    await server.add(testItem({ id: "seed" }));
    const held = (await cli.get("seed"))!;

    const edited = (await server.get("seed"))!;
    edited.caption = "New caption";
    await server.add(edited);
    await cli.claim(held, "youtube", NOW);

    const saved = (await onDisk()).find((item) => item.id === "seed")!;
    expect(saved.caption).toBe("New caption");
    expect(saved.platforms.youtube!.claimedAt).toBe(NOW.toISOString());
  });

  it("does not bring back an item the other writer removed", async () => {
    const server = open();
    const cli = open();
    await server.add(testItem({ id: "seed" }));
    await server.add(testItem({ id: "keep", publishAt: "2026-07-11T10:00:00.000Z" }));
    const held = (await cli.get("seed"))!;
    await cli.list();

    await server.remove("seed");
    await cli.claim(held, "youtube", NOW);

    expect((await onDisk()).map((item) => item.id)).toEqual(["keep"]);
    expect(await cli.get("seed")).toBeUndefined();
  });

  it("keeps the item objects callers are holding live after a merge", async () => {
    const server = open();
    const cli = open();
    await server.add(testItem({ id: "seed" }));
    const held = (await cli.get("seed"))!;

    await server.add(testItem({ id: "other", publishAt: "2026-07-11T10:00:00.000Z" }));
    await cli.claim(held, "youtube", NOW);

    expect(await cli.get("seed")).toBe(held);
    expect((await cli.get("other"))!.id).toBe("other");
  });

  it("stamps the items it saves with when they changed", async () => {
    const queue = open();
    await queue.add(testItem({ id: "seed" }));
    await queue.add(testItem({ id: "later", publishAt: "2026-07-11T10:00:00.000Z" }));
    const before = (await onDisk()).find((item) => item.id === "seed")!.updatedAt;

    const held = (await queue.get("seed"))!;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await queue.claim(held, "youtube", NOW);

    const saved = await onDisk();
    expect(before).toBeTruthy();
    expect(saved.find((item) => item.id === "seed")!.updatedAt! > before!).toBe(true);
    expect(saved.find((item) => item.id === "later")!.updatedAt).toBeTruthy();
  });

  it("leaves no lock file or temporary file behind", async () => {
    const queue = open();
    await queue.add(testItem({ id: "seed" }));
    await queue.add(testItem({ id: "two", publishAt: "2026-07-11T10:00:00.000Z" }));
    expect((await readdir(dir)).filter((name) => name !== "publish-queue.log")).toEqual(["publish-queue.json"]);
  });

  it("refuses to overwrite a queue file it cannot parse", async () => {
    const queue = open();
    await queue.add(testItem({ id: "seed" }));
    const held = (await queue.get("seed"))!;
    await writeFile(file, "[{ half a file", "utf8");

    await expect(queue.claim(held, "youtube", NOW)).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("[{ half a file");
  });
});

function runWriter(name: string, barrier: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", path.join(process.cwd(), "src", "lib", "publisher", "queueWriterChild.ts"), file, name, barrier],
      { cwd: process.cwd(), env: { ...process.env, CAPITAL_COMMAND_DATA_DIR: dir }, stdio: ["ignore", "pipe", "pipe"] }
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, output }));
  });
}

describe("two processes adding to one publish queue", () => {
  it("both items survive, even when each loaded the queue before either saved", async () => {
    await open().add(testItem({ id: "seed", publishAt: "2026-07-01T10:00:00.000Z" }));
    const barrier = path.join(dir, "barrier");
    await mkdir(barrier);

    const [a, b] = await Promise.all([runWriter("a", barrier), runWriter("b", barrier)]);

    expect(a.output).toBe("");
    expect(b.output).toBe("");
    expect([a.code, b.code]).toEqual([0, 0]);
    expect((await onDisk()).map((item) => item.id).sort()).toEqual(["item-a", "item-b", "seed"]);
    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp") || name.endsWith(".lock"))).toEqual([]);
  }, 90_000);
});
