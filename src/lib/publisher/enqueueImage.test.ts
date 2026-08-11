import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PUBLISHING_OFF_MESSAGE } from "@/lib/publisher/enabledMessage";

/**
 * enqueueImagePost — the picture twin of enqueue(). Nothing here posts: it
 * proves what lands in the queue and what is refused before it can.
 */

const hosted: string[][] = [];

vi.mock("@/lib/publisher/hosting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/publisher/hosting")>();
  return {
    ...actual,
    hostImages: vi.fn(async (paths: string[], itemId: string) => {
      hosted.push(paths);
      return paths.map((entry, index) => `publisher/media/${itemId}/${index}-${path.basename(entry)}`);
    })
  };
});

let dir: string;
let images: string[];
/** A picture no test has booked yet — a post the queue carries is refused now. */
let spare: string;

beforeEach(async () => {
  hosted.length = 0;
  dir = await mkdtemp(path.join(os.tmpdir(), "image-post-"));
  images = [path.join(dir, "slide-1.png"), path.join(dir, "slide-2.png"), path.join(dir, "slide-3.png")];
  spare = path.join(dir, "spare.png");
  for (const image of [...images, spare]) await writeFile(image, Buffer.alloc(64, 7));

  vi.stubEnv("PUBLISH_ENABLED", "true");
  vi.stubEnv("PUBLISH_PLATFORMS", "youtube,instagram,tiktok,facebook");
  vi.stubEnv("IG_USER_ID", "17840000000000000");
  vi.stubEnv("IG_ACCESS_TOKEN", "ig-token");
  vi.stubEnv("FB_PAGE_ID", "10000000000000000");
  vi.stubEnv("FB_PAGE_ACCESS_TOKEN", "fb-token");
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

/**
 * Three weeks out, computed rather than fixed: a booking must be in the future
 * AND not on the day it is made (schedule.ts), so a hard-coded date would turn
 * this suite red the moment it passed.
 */
const FUTURE_SLOT = `${new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10)}T12:30`;

const BASE = {
  publishAt: FUTURE_SLOT,
  title: "Five things that changed",
  caption: "The deck from today's stream",
  hashtags: ["#ai"]
};

describe("enqueueImagePost", () => {
  it("books a carousel to the picture platforms and hosts every image in order", async () => {
    const { enqueueImagePost, publishQueue } = await load();

    const item = await enqueueImagePost({ ...BASE, imagePaths: images });

    expect(item.mediaKind).toBe("image");
    expect(item.imagePaths).toHaveLength(3);
    expect(item.imagePaths?.map((entry) => path.basename(entry))).toEqual(["slide-1.png", "slide-2.png", "slide-3.png"]);
    // The first picture also fills clipPath so path-based lookups still see it.
    expect(item.clipPath).toBe(item.imagePaths?.[0]);
    // YouTube and TikTok are dropped, not queued to fail at the slot.
    expect(Object.keys(item.platforms).sort()).toEqual(["facebook", "instagram"]);
    expect(hosted[0]).toEqual(images);
    expect(item.imageKeys).toHaveLength(3);

    // It is really in the queue, at a future slot, with nothing published.
    const stored = await publishQueue().get(item.id);
    expect(stored?.imagePaths).toHaveLength(3);
    expect(Object.values(stored?.platforms ?? {}).every((state) => state.status === "pending")).toBe(true);
  });

  it("posts a single picture as a single-image item", async () => {
    const { enqueueImagePost } = await load();
    const item = await enqueueImagePost({ ...BASE, imagePaths: [images[0]], platforms: ["instagram"] });
    expect(item.imagePaths).toEqual([path.relative(process.cwd(), images[0])]);
    expect(Object.keys(item.platforms)).toEqual(["instagram"]);
  });

  it("refuses a platform that cannot take pictures instead of queueing it", async () => {
    const { enqueueImagePost, publishQueue } = await load();
    const before = (await publishQueue().list()).length;
    await expect(enqueueImagePost({ ...BASE, imagePaths: images, platforms: ["youtube"] })).rejects.toThrow(/YouTube/);
    await expect(enqueueImagePost({ ...BASE, imagePaths: images, platforms: ["tiktok"] })).rejects.toThrow(/TikTok/);
    expect(await publishQueue().list()).toHaveLength(before);
  });

  it("refuses a deck bigger than one post can carry", async () => {
    const { enqueueImagePost } = await load();
    const many = Array.from({ length: 11 }, () => images[0]);
    await expect(enqueueImagePost({ ...BASE, imagePaths: many })).rejects.toThrow(/at most 10/);
  });

  it("refuses a file that is not a picture, and one that is not there", async () => {
    const { enqueueImagePost } = await load();
    await expect(enqueueImagePost({ ...BASE, imagePaths: [path.join(dir, "clip.mp4")] })).rejects.toThrow(/not a supported picture/);
    await expect(enqueueImagePost({ ...BASE, imagePaths: [path.join(dir, "missing.png")] })).rejects.toThrow(/not found/);
  });

  it("refuses to book a picture post when the images cannot be hosted", async () => {
    vi.stubEnv("S3_ENDPOINT", "");
    vi.stubEnv("S3_BUCKET", "");
    vi.resetModules();
    const { enqueueImagePost } = await load();
    await expect(enqueueImagePost({ ...BASE, imagePaths: images })).rejects.toThrow(/public HTTPS URL/);
  });

  it("tracks an unconnected platform as a manual reminder, same as a video post", async () => {
    vi.stubEnv("IG_USER_ID", "");
    vi.stubEnv("IG_ACCESS_TOKEN", "");
    vi.resetModules();
    const { enqueueImagePost } = await load();
    const item = await enqueueImagePost({ ...BASE, imagePaths: images });
    expect(item.platforms.instagram?.status).toBe("manual");
    expect(item.platforms.facebook?.status).toBe("pending");
  });

  it("tells you the slides are rendered rather than telling you to post a clip", async () => {
    vi.stubEnv("IG_USER_ID", "");
    vi.stubEnv("IG_ACCESS_TOKEN", "");
    vi.resetModules();
    const { enqueueImagePost } = await load();
    const note = (await enqueueImagePost({ ...BASE, imagePaths: images })).platforms.instagram?.note ?? "";
    expect(note).toContain("all 3 slides are rendered");
    expect(note).not.toContain("clip");

    // A picture the deck above did not carry: a post the queue already holds is
    // refused now (duplicates.ts).
    const single = await enqueueImagePost({ ...BASE, imagePaths: [spare] });
    expect(single.platforms.instagram?.note).toContain("the picture is rendered");
  });

  it("does not book anything while publishing is switched off", async () => {
    vi.stubEnv("PUBLISH_ENABLED", "false");
    vi.resetModules();
    const { enqueueImagePost } = await load();
    await expect(enqueueImagePost({ ...BASE, imagePaths: images })).rejects.toThrow(PUBLISHING_OFF_MESSAGE);
  });
});
