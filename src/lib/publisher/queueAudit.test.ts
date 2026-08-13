import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogPath, MAX_LOG_BYTES, readQueueAudit, recordQueueMutation } from "@/lib/publisher/audit";
import { dataPath } from "@/lib/paths";

/**
 * The two questions nobody could answer on 2026-08-12: what put 27 items
 * pointing at a FOLDER on the live queue, and who rewrote ~306 publish times.
 * A folder is now refused at the door, and every mutation that survives says
 * which process and which entry point made it.
 */

vi.mock("@/lib/publisher/hosting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/publisher/hosting")>();
  return {
    ...actual,
    hostImages: vi.fn(async (paths: string[], itemId: string) =>
      paths.map((entry, index) => `publisher/media/${itemId}/${index}-${path.basename(entry)}`)
    )
  };
});

let dir: string;
let picture: string;
let folder: string;

function dateKeyIn(days: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(Date.now() + days * 86_400_000));
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "queue-audit-"));
  picture = path.join(dir, "slide.png");
  await writeFile(picture, Buffer.alloc(64, 3));
  // A directory whose NAME looks like a picture, so the extension check cannot
  // be what refuses it — exactly the shape the carousel folders had.
  folder = path.join(dir, "deck.png");
  await mkdir(folder, { recursive: true });

  // The suite shares one temp data folder per file, and the log is append-only
  // by design — so each test starts from an empty one or it reads the previous
  // test's lines.
  await mkdir(path.dirname(auditLogPath()), { recursive: true });
  await rm(auditLogPath(), { force: true });
  await rm(`${auditLogPath()}.1`, { force: true });

  vi.stubEnv("PUBLISH_ENABLED", "true");
  vi.stubEnv("PUBLISH_PLATFORMS", "instagram,facebook");
  vi.stubEnv("PUBLISH_TIMEZONE", "America/Toronto");
  vi.stubEnv("IG_USER_ID", "17840000000000000");
  vi.stubEnv("IG_ACCESS_TOKEN", "ig-token");
  vi.stubEnv("S3_ENDPOINT", "https://example.r2.test");
  vi.stubEnv("S3_BUCKET", "bucket");
  vi.stubEnv("S3_ACCESS_KEY_ID", "key");
  vi.stubEnv("S3_SECRET_ACCESS_KEY", "secret");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function load() {
  return {
    enqueue: (await import("@/lib/publisher/enqueue")).enqueue,
    enqueueImagePost: (await import("@/lib/publisher/enqueue")).enqueueImagePost,
    publishQueue: (await import("@/lib/publisher/queue")).publishQueue
  };
}

const COPY = { title: "A deck about agents", caption: "copy", hashtags: ["#ai"] };

describe("a queue item must point at a file", () => {
  it("refuses a clip path that is a directory", async () => {
    const { enqueue, publishQueue } = await load();
    const before = (await publishQueue().list()).length;

    await expect(
      enqueue({ ...COPY, clipPath: folder, publishAt: `${dateKeyIn(2)}T12:30` })
    ).rejects.toThrow(/folder, not a file/i);

    expect(await publishQueue().list()).toHaveLength(before);
  });

  it("refuses a picture path that is a directory named like a picture", async () => {
    const { enqueueImagePost } = await load();

    await expect(
      enqueueImagePost({ ...COPY, imagePaths: [folder], publishAt: `${dateKeyIn(2)}T12:30` })
    ).rejects.toThrow(/folder, not a file/i);
  });

  it("still refuses a path that is not there at all", async () => {
    const { enqueue } = await load();

    await expect(
      enqueue({ ...COPY, clipPath: path.join(dir, "gone.mp4"), publishAt: `${dateKeyIn(2)}T12:30` })
    ).rejects.toThrow(/not found/i);
  });
});

describe("every queue mutation is attributable", () => {
  it("records the entry point, the process and the file when an item is booked", async () => {
    const { enqueueImagePost } = await load();
    const item = await enqueueImagePost({ ...COPY, imagePaths: [picture], publishAt: `${dateKeyIn(2)}T12:30` });

    const lines = await readQueueAudit();
    const added = lines.filter((line) => line.action === "add");
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      action: "add",
      writer: "enqueue-image",
      id: item.id,
      clipPath: item.clipPath,
      pid: process.pid,
      cwd: process.cwd()
    });
    expect(Number.isNaN(Date.parse(added[0].at))).toBe(false);
  });

  it("names the caller a removal came from", async () => {
    const { enqueueImagePost, publishQueue } = await load();
    const item = await enqueueImagePost({ ...COPY, imagePaths: [picture], publishAt: `${dateKeyIn(2)}T12:30` });

    await publishQueue().remove(item.id, "cli-remove");

    const removed = (await readQueueAudit()).filter((line) => line.action === "remove");
    expect(removed.map((line) => [line.writer, line.id])).toEqual([["cli-remove", item.id]]);
  });

  it("records one line per publish time a bulk move rewrites", async () => {
    const { enqueueImagePost, publishQueue } = await load();
    const item = await enqueueImagePost({ ...COPY, imagePaths: [picture], publishAt: `${dateKeyIn(2)}T12:30` });
    const moved = `${dateKeyIn(5)}T12:30:00.000Z`;

    const changed = await publishQueue().applyPublishTimes([{ id: item.id, publishAt: moved }], "cli-shuffle");

    expect(changed).toBe(1);
    const times = (await readQueueAudit()).filter((line) => line.action === "publish-time");
    expect(times).toHaveLength(1);
    expect(times[0]).toMatchObject({ writer: "cli-shuffle", id: item.id, publishAt: moved });
  });

  it("writes nothing when a move changes nothing", async () => {
    const { enqueueImagePost, publishQueue } = await load();
    const item = await enqueueImagePost({ ...COPY, imagePaths: [picture], publishAt: `${dateKeyIn(2)}T12:30` });

    await publishQueue().applyPublishTimes([{ id: item.id, publishAt: item.publishAt }], "cli-shuffle");

    expect((await readQueueAudit()).filter((line) => line.action === "publish-time")).toEqual([]);
  });

  it("labels a write that named nobody rather than leaving a gap", async () => {
    const { enqueueImagePost, publishQueue } = await load();
    const item = await enqueueImagePost({ ...COPY, imagePaths: [picture], publishAt: `${dateKeyIn(2)}T12:30` });

    await publishQueue().remove(item.id);

    const removed = (await readQueueAudit()).filter((line) => line.action === "remove");
    expect(removed[0].writer).toBe("unattributed");
  });
});

describe("the log cannot break a publish or grow forever", () => {
  it("rotates once it passes the cap instead of growing", async () => {
    await mkdir(path.dirname(auditLogPath()), { recursive: true });
    await writeFile(auditLogPath(), Buffer.alloc(MAX_LOG_BYTES + 1, 0x0a));

    await recordQueueMutation({ action: "add", writer: "cli-adopt", id: "abc123", clipPath: "clips/a.mp4" });

    const rotated = await stat(`${auditLogPath()}.1`);
    expect(rotated.size).toBeGreaterThan(MAX_LOG_BYTES);
    const current = await readFile(auditLogPath(), "utf8");
    expect(current.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(current)).toMatchObject({ id: "abc123", writer: "cli-adopt" });
  });

  it("swallows a write it cannot make, and still books the post", async () => {
    // A FILE where the data folder should be: every write under it is ENOTDIR.
    const blocked = path.join(dir, "not-a-folder");
    await writeFile(blocked, "");
    vi.stubEnv("CAPITAL_COMMAND_DATA_DIR", blocked);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      recordQueueMutation({ action: "add", writer: "enqueue", id: "def456", clipPath: "clips/b.mp4" })
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("skips a half-written line rather than refusing to read the log", async () => {
    await mkdir(path.dirname(auditLogPath()), { recursive: true });
    await recordQueueMutation({ action: "add", writer: "enqueue", id: "good01", clipPath: "clips/c.mp4" });
    await writeFile(auditLogPath(), `{"at":"2026-08-12T00:00:0`, { flag: "a" });

    expect((await readQueueAudit()).map((line) => line.id)).toEqual(["good01"]);
  });

  it("lives in the data folder, so a sandbox never writes production's log", () => {
    expect(auditLogPath()).toBe(dataPath("publish-queue.log"));
  });
});
