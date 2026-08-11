import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two refusals every route into the queue inherits, exercised through
 * `enqueueImagePost` because it is the twin that needs no ffmpeg. Both are
 * enforced in the shared `assertSchedulable`, so `enqueue()` gets the same
 * answer for a video.
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
let other: string;

/** Local wall-clock date `days` from now, in the publish timezone used below. */
function dateKeyIn(days: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(Date.now() + days * 86_400_000));
  return parts;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "enqueue-guards-"));
  picture = path.join(dir, "slide.png");
  other = path.join(dir, "another.png");
  for (const file of [picture, other]) await writeFile(file, Buffer.alloc(64, 3));

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
    enqueueImagePost: (await import("@/lib/publisher/enqueue")).enqueueImagePost,
    publishQueue: (await import("@/lib/publisher/queue")).publishQueue
  };
}

const COPY = { title: "A deck about agents", caption: "copy", hashtags: ["#ai"] };

describe("nothing is scheduled for the day it is booked", () => {
  it("refuses a time later today, whatever the caller asks for", async () => {
    const { enqueueImagePost, publishQueue } = await load();
    const before = (await publishQueue().list()).length;

    await expect(
      enqueueImagePost({ ...COPY, imagePaths: [picture], publishAt: `${dateKeyIn(0)}T23:59` })
    ).rejects.toThrow(/today/i);

    expect(await publishQueue().list()).toHaveLength(before);
  });

  it("takes tomorrow", async () => {
    const { enqueueImagePost } = await load();
    const item = await enqueueImagePost({ ...COPY, imagePaths: [picture], publishAt: `${dateKeyIn(1)}T12:30` });
    expect(item.publishAt).toBeTruthy();
  });

  it("lets a person override it, and nothing automatic does", async () => {
    const { enqueueImagePost } = await load();
    const item = await enqueueImagePost({
      ...COPY,
      imagePaths: [picture],
      publishAt: `${dateKeyIn(0)}T23:59`,
      allowSameDay: true
    });
    expect(item.publishAt).toBeTruthy();
  });
});

describe("nothing is queued twice", () => {
  it("refuses a second post of a picture the queue already carries", async () => {
    const { enqueueImagePost, publishQueue } = await load();
    const first = await enqueueImagePost({ ...COPY, imagePaths: [picture], publishAt: `${dateKeyIn(2)}T12:30` });

    await expect(
      // A different slot, a different caption — same file, so it is the same post.
      enqueueImagePost({ ...COPY, caption: "rewritten", imagePaths: [picture], publishAt: `${dateKeyIn(3)}T12:30` })
    ).rejects.toThrow(/already scheduled/i);

    expect((await publishQueue().list()).filter((item) => item.id === first.id)).toHaveLength(1);
  });

  it("still books a different picture", async () => {
    const { enqueueImagePost } = await load();
    await enqueueImagePost({ ...COPY, imagePaths: [picture], publishAt: `${dateKeyIn(2)}T12:30` });
    const second = await enqueueImagePost({ ...COPY, imagePaths: [other], publishAt: `${dateKeyIn(3)}T12:30` });
    expect(second.imagePaths).toHaveLength(1);
  });

  it("lets a person book the duplicate on purpose", async () => {
    const { enqueueImagePost } = await load();
    await enqueueImagePost({ ...COPY, imagePaths: [picture], publishAt: `${dateKeyIn(2)}T12:30` });
    const again = await enqueueImagePost({
      ...COPY,
      imagePaths: [picture],
      publishAt: `${dateKeyIn(4)}T12:30`,
      allowDuplicate: true
    });
    expect(again.id).toBeTruthy();
  });
});
