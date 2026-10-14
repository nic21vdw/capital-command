import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { readReviewPolicy, resetReviewPolicyCache, reviewPolicyPath, writeReviewPolicy } from "@/lib/publisher/approvalStore";
import { PublishQueue } from "@/lib/publisher/queue";
import { FileQueueStore } from "@/lib/publisher/store";
import { testConfig, testItem } from "@/lib/publisher/test-helpers";
import { isLockHeld, lockFilePath, withFileLock } from "@/lib/storage/file-lock";
import type { QueueItem } from "@/lib/publisher/types";

const control = vi.hoisted(() => ({ failPolicy: false, beforePolicy: null as (() => Promise<void>) | null }));
vi.mock("@/lib/storage/atomic-json", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/atomic-json")>();
  return { ...actual, atomicWriteJson: async (...args: Parameters<typeof actual.atomicWriteJson>) => {
    if (String(args[0]).endsWith("review-policy.json")) {
      await control.beforePolicy?.();
      if (control.failPolicy) throw new Error("injected policy save failure");
    }
    return actual.atomicWriteJson(...args);
  } };
});

let queue: PublishQueue;
let file: string;
vi.mock("@/lib/publisher/queue", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/publisher/queue")>(), publishQueue: () => queue
}));
const soon = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const put = async (body: unknown) => (await import("@/app/api/review/policy/route")).PUT(new Request("http://localhost:3000/api/review/policy", {
  method: "PUT", body: JSON.stringify(body)
}));

beforeEach(async () => {
  control.failPolicy = false;
  control.beforePolicy = null;
  resetReviewPolicyCache();
  await mkdir(path.dirname(reviewPolicyPath()), { recursive: true });
  await writeReviewPolicy({ instagram: "hold", tiktok: "hold", threads: "hold" }, new Date(soon(-400)));
  file = dataPath(`policy-transition-${crypto.randomUUID()}.json`);
  queue = new PublishQueue(new FileQueueStore(file), testConfig({ bookingHorizonDays: 0, shortsPerDay: 2 }));
});

describe("policy changes never partially authorize held posts", () => {
  it("leaves every channel and queue leg untouched if one opening channel cannot be placed", async () => {
    await queue.add(testItem({ id: "fresh", platformIds: ["instagram"], publishAt: soon(-1) }));
    await queue.add(testItem({ id: "stuck", platformIds: ["tiktok"], publishAt: soon(-300), clipPath: "data/clips/outputs/job1/stuck.mp4" }));
    const before = await readFile(file, "utf8");
    const response = await put({ instagram: "auto", tiktok: "auto" });
    expect(response.status).toBe(409);
    expect(readReviewPolicy()).toMatchObject({ instagram: "hold", tiktok: "hold" });
    expect(await readFile(file, "utf8")).toBe(before);
    expect(await queue.dueItems(new Date())).toEqual([]);
  });

  it("keeps posts held and unstamped when saving the policy fails after queue preparation", async () => {
    await queue.add(testItem({ id: "fresh", platformIds: ["instagram"], publishAt: soon(-1) }));
    control.failPolicy = true;
    const response = await put({ instagram: "auto" });
    expect(response.status).toBe(500);
    expect(readReviewPolicy().instagram).toBe("hold");
    expect((await queue.get("fresh"))?.platforms.instagram?.approvedAt).toBeUndefined();
    expect(await queue.dueItems(new Date())).toEqual([]);
  });

  it("also keeps Threads held when another requested channel cannot be placed", async () => {
    await queue.add(testItem({ id: "stuck", platformIds: ["tiktok"], publishAt: soon(-300) }));
    expect((await put({ threads: "auto", tiktok: "auto" })).status).toBe(409);
    expect(readReviewPolicy()).toMatchObject({ threads: "hold", tiktok: "hold" });
  });

  it("refuses an entire single-channel transition rather than approving its placeable subset", async () => {
    await queue.add(testItem({ id: "fresh", platformIds: ["instagram"], publishAt: soon(-1) }));
    await queue.add(testItem({ id: "stuck", platformIds: ["instagram"], publishAt: soon(-300), clipPath: "data/clips/outputs/job1/stuck.mp4" }));
    const before = await readFile(file, "utf8");
    expect((await put({ instagram: "auto" })).status).toBe(409);
    expect(await readFile(file, "utf8")).toBe(before);
    expect(readReviewPolicy().instagram).toBe("hold");
  });

  it("never changes the policy when queue persistence fails", async () => {
    await queue.add(testItem({ id: "fresh", platformIds: ["instagram"], publishAt: soon(-1) }));
    const before = await readFile(file, "utf8");
    class FailingStore extends FileQueueStore {
      override async save(): Promise<void> { throw new Error("injected queue save failure"); }
    }
    queue = new PublishQueue(new FailingStore(file), testConfig());
    expect((await put({ instagram: "auto" })).status).toBe(500);
    expect(await readFile(file, "utf8")).toBe(before);
    expect(readReviewPolicy().instagram).toBe("hold");
    expect(await queue.dueItems(new Date())).toEqual([]);
  });

  it("keeps a prepared split held on policy failure and retries from its durable identity", async () => {
    queue = new PublishQueue(new FileQueueStore(file), testConfig());
    const original = testItem({ id: "old", platformIds: ["youtube", "instagram"], publishAt: soon(-100) });
    original.platforms.youtube = { status: "scheduled", postId: "yt-existing", attempts: 1, approvedAt: "2026-07-01T10:00:00.000Z" };
    await queue.add(original);
    control.failPolicy = true;
    expect((await put({ instagram: "auto" })).status).toBe(500);
    const prepared = await queue.list();
    const split = prepared.find((item) => item.platforms.instagram)!;
    expect(split.id).not.toBe("old");
    expect(new Date(split.publishAt).getTime()).toBeGreaterThan(Date.now());
    expect(split.platforms.instagram?.approvedAt).toBeUndefined();
    expect(queue.duePlatforms(split, new Date())).toEqual([]);
    expect((await queue.get("old"))?.platforms.youtube).toEqual(original.platforms.youtube);
    control.failPolicy = false;
    expect((await put({ instagram: "auto" })).status).toBe(200);
    expect((await queue.list()).filter((item) => item.platforms.instagram).map((item) => item.id)).toEqual([split.id]);
    expect(split.platforms.instagram?.approvedAt).toBeUndefined();
    expect(readReviewPolicy().instagram).toBe("auto");
    expect((await put({ instagram: "hold" })).status).toBe(200);
    expect((await queue.awaitingApproval()).some((entry) => entry.item.id === split.id)).toBe(true);
  });

  it("keeps both locks and holds prepared rows until the policy write commits", async () => {
    queue = new PublishQueue(new FileQueueStore(file), testConfig());
    await queue.add(testItem({ id: "old", platformIds: ["instagram"], publishAt: soon(-100) }));
    let checked = false;
    control.beforePolicy = async () => {
      expect(await isLockHeld(reviewPolicyPath())).toBe(true);
      expect(await isLockHeld(file)).toBe(true);
      expect(readReviewPolicy().instagram).toBe("hold");
      const rows = JSON.parse(await readFile(file, "utf8")) as QueueItem[];
      expect(rows[0].platforms.instagram?.approvedAt).toBeUndefined();
      expect(queue.duePlatforms(rows[0], new Date())).toEqual([]);
      checked = true;
    };
    expect((await put({ instagram: "auto" })).status).toBe(200);
    expect(checked).toBe(true);
    expect(readReviewPolicy().instagram).toBe("auto");
    expect(await isLockHeld(file)).toBe(false);
    expect(await isLockHeld(reviewPolicyPath())).toBe(false);
  });

  it("selects new held targets from the latest queue after waiting for its lock", async () => {
    await queue.add(testItem({ id: "first", platformIds: ["instagram"], publishAt: soon(-100) }));
    let reached!: () => void;
    let resume!: () => void;
    const ready = new Promise<void>((resolve) => { reached = resolve; });
    const proceed = new Promise<void>((resolve) => { resume = resolve; });
    class PausedStore extends FileQueueStore {
      override async withLock<T>(work: () => Promise<T>): Promise<T> {
        reached();
        await proceed;
        return super.withLock(work);
      }
    }
    queue = new PublishQueue(new PausedStore(file), testConfig());
    const changing = put({ instagram: "auto" });
    await ready;
    const other = new PublishQueue(new FileQueueStore(file), testConfig());
    await other.add(testItem({ id: "second", platformIds: ["instagram"], publishAt: soon(-100), clipPath: "data/clips/outputs/job1/second.mp4" }));
    resume();
    const response = await changing;
    expect(response.status).toBe(200);
    expect((await response.json()).released.approved).toBe(2);
    const rows = await other.list();
    expect(rows).toHaveLength(2);
    expect(rows.every((item) => Date.parse(item.publishAt) > Date.now())).toBe(true);
    expect(rows.every((item) => !item.platforms.instagram?.approvedAt)).toBe(true);
  });

  it("does not let a second process expire a live policy transition while it waits on the queue", async () => {
    let completed: Promise<number | null> | undefined;
    let output = "";
    try {
      await withFileLock(reviewPolicyPath(), async () => {
        const lock = lockFilePath(reviewPolicyPath());
        const record = JSON.parse(await readFile(lock, "utf8"));
        record.acquiredAt = new Date(Date.now() - 60_000).toISOString();
        await writeFile(lock, JSON.stringify(record), "utf8");
        const script = [
          `import policyStore from ${JSON.stringify(path.join(process.cwd(), "src/lib/publisher/approvalStore.ts"))};`,
          "const { writeReviewPolicy } = policyStore;",
          'console.log("ready");',
          'await writeReviewPolicy({ threads: "auto" });',
          'console.log("committed");'
        ].join("\n");
        const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
          cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"]
        });
        child.stdout.on("data", (chunk) => { output += String(chunk); });
        child.stderr.on("data", (chunk) => { output += String(chunk); });
        completed = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
        await vi.waitFor(() => expect(output).toContain("ready"));
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(output).not.toContain("committed");
        expect(readReviewPolicy().threads).toBe("hold");
      });
    } finally {
      if (completed) expect(await completed, output).toBe(0);
    }
    expect(output).toContain("committed");
    expect(readReviewPolicy().threads).toBe("auto");
  });
});
