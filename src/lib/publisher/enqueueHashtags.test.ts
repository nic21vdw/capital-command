import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * How enqueue merges the metadata it is given with the metadata it generates.
 * The Uploading Center sends an AI caption whose hashtags travel in `hashtags`;
 * if they were left inside the caption, `hashtags` came in empty, enqueue
 * generated a second set, and `composeCaption` appended it under the first.
 */

const generated = vi.hoisted(() => vi.fn());
vi.mock("@/lib/publisher/metadata", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/publisher/metadata")>()),
  generateClipMetadata: generated
}));
vi.mock("@/lib/publisher/hosting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/publisher/hosting")>()),
  hostImages: vi.fn(async (paths: string[], itemId: string) => paths.map((entry) => `m/${itemId}/${path.basename(entry)}`))
}));

let picture: string;
const SLOT = `${new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10)}T12:30`;

beforeEach(async () => {
  generated.mockReset();
  generated.mockResolvedValue({ title: "Generated title", description: "Generated caption", hashtags: ["#generated"] });
  const dir = await mkdtemp(path.join(os.tmpdir(), "enqueue-tags-"));
  picture = path.join(dir, "slide-1.png");
  await writeFile(picture, Buffer.alloc(64, 7));
  vi.stubEnv("PUBLISH_ENABLED", "true");
  vi.stubEnv("PUBLISH_PLATFORMS", "instagram,facebook");
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

async function book(extra: Record<string, unknown>) {
  const { enqueueImagePost } = await import("@/lib/publisher/enqueue");
  return enqueueImagePost({ imagePaths: [picture], publishAt: SLOT, platforms: ["instagram"], ...extra });
}

describe("enqueue metadata merge", () => {
  it("keeps the hashtags it was sent instead of generating a second set", async () => {
    const item = await book({ title: "Mine", caption: "Body only", hashtags: ["#mine", "#ai"] });

    expect(generated).not.toHaveBeenCalled();
    expect(item.hashtags).toEqual(["#mine", "#ai"]);
    expect(item.caption).toBe("Body only");
  });

  it("still keeps the sent hashtags and caption when only the title has to be generated", async () => {
    const item = await book({ caption: "Body only", hashtags: ["#mine"] });

    expect(item.title).toBe("Generated title");
    expect(item.caption).toBe("Body only");
    expect(item.hashtags).toEqual(["#mine"]);
  });

  it("generates hashtags only when none were sent", async () => {
    const item = await book({ title: "Mine", caption: "Body only" });

    expect(item.hashtags).toEqual(["#generated"]);
  });
});
