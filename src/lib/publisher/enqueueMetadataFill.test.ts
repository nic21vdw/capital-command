import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A post booked with a blank caption must never reach the queue blank.
 *
 * The Uploading Center's card says "leave empty to auto-generate on schedule"
 * and sends no caption when the box is empty. `enqueue` filled gaps with `??=`,
 * which does not see `""`, so a whitespace caption stayed as it was; and when
 * no model answers the standing description is empty, so the "generated"
 * caption was empty too. With no hashtags sent, the post carried only the
 * generic `#shorts`. These specs run the real offline path (no AI key) through
 * `enqueue`, the one door every route into the queue uses.
 */

vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  return { ...actual, aiConfigured: () => false, runAi: vi.fn(async () => null) };
});
// The 9:16 re-render is minutes of ffmpeg and is not what is under test.
vi.mock("@/lib/publisher/vertical", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/publisher/vertical")>()),
  prepareVerticalMedia: vi.fn(async (file: string) => ({ path: file, converted: false }))
}));

let dir: string;
let booked = 0;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "enqueue-fill-"));
  vi.stubEnv("PUBLISH_ENABLED", "true");
  vi.stubEnv("PUBLISH_PLATFORMS", "youtube");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Each booking gets its own file and its own day: the queue refuses a repeat and a crowded day. */
async function book(extra: Record<string, unknown>) {
  booked += 1;
  const clip = path.join(dir, `clip-${booked}.mp4`);
  await writeFile(clip, Buffer.alloc(64, booked));
  const publishAt = `${new Date(Date.now() + (10 + booked) * 86_400_000).toISOString().slice(0, 10)}T12:30`;
  const { enqueue } = await import("@/lib/publisher/enqueue");
  return enqueue({ clipPath: clip, publishAt, platforms: ["youtube"], ...extra });
}

describe("enqueue with a blank caption", () => {
  it("never queues an empty caption, whether it is missing, empty or only spaces", async () => {
    for (const caption of [undefined, "", "   "]) {
      vi.resetModules();
      const item = await book({ title: "Claude wrote the migration and I almost shipped the bug", caption });
      expect(item.caption.trim()).not.toBe("");
    }
  });

  it("falls back to the clip's own title (without its hashtags) when no description exists", async () => {
    const item = await book({ title: "Cron jobs are the unsung heroes #AI #coding", caption: "" });

    expect(item.caption).toBe("Cron jobs are the unsung heroes");
  });

  it("keeps the clip's own hashtags instead of only #shorts", async () => {
    const item = await book({ title: "Cron jobs are the unsung heroes #AI #coding", caption: "" });

    expect(item.hashtags).toEqual(["#AI", "#coding", "#shorts"]);
  });

  it("still tags a clip that has none of its own, so no short posts untagged", async () => {
    const item = await book({ title: "Plain title", caption: "" });

    expect(item.hashtags.length).toBeGreaterThan(0);
  });

  it("leaves a caption and hashtags that were sent exactly as sent", async () => {
    const item = await book({ title: "Mine", caption: "My words", hashtags: ["#mine"] });

    expect(item.caption).toBe("My words");
    expect(item.hashtags).toEqual(["#mine"]);
  });
});
