import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LINKEDIN_KEYS } from "@/lib/publisher/linkedinKeys";

vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  return { ...actual, aiConfigured: () => false, runAi: vi.fn(async () => null) };
});
vi.mock("@/lib/publisher/vertical", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/publisher/vertical")>()),
  prepareVerticalMedia: vi.fn(async (file: string) => ({ path: file, converted: false }))
}));
vi.mock("@/lib/publisher/hosting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/publisher/hosting")>();
  return {
    ...actual,
    hostImages: vi.fn(async (paths: string[], itemId: string) => paths.map((entry, index) => `publisher/media/${itemId}/${index}`)),
    hostMedia: vi.fn(async (_file: string, itemId: string) => ({ key: `publisher/media/${itemId}/clip` }))
  };
});

vi.setConfig({ testTimeout: 30_000 });

let dir: string;
let counter = 0;

const slotAt = (days: number) => `${new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)}T12:30`;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "linkedin-booking-"));
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
  vi.stubEnv("LINKEDIN_CLIENT_ID", "id");
  vi.stubEnv("LINKEDIN_CLIENT_SECRET", "secret");
  vi.resetModules();
  const { setCachedTokens } = await import("@/lib/publisher/tokens");
  await setCachedTokens({
    [LINKEDIN_KEYS.accessToken]: "li-access",
    [LINKEDIN_KEYS.accessExpiresAt]: String(Date.now() + 30 * 86_400_000),
    [LINKEDIN_KEYS.author]: "urn:li:person:abc"
  });
});

afterEach(() => vi.unstubAllEnvs());

async function file(name: string): Promise<string> {
  counter += 1;
  const target = path.join(dir, `${counter}-${name}`);
  await writeFile(target, Buffer.alloc(64, counter));
  return target;
}

const copy = { title: "Five things", caption: "The deck", hashtags: ["#ai"] };

describe("LinkedIn only posts what is public", () => {
  it("holds a private picture post as a reminder, with the reason", async () => {
    const { enqueueImagePost } = await import("@/lib/publisher/enqueue");
    const item = await enqueueImagePost({
      ...copy,
      imagePaths: [await file("a.png")],
      publishAt: slotAt(21),
      platforms: ["linkedin"],
      visibility: "private"
    });
    expect(item.platforms.linkedin).toMatchObject({ status: "manual", attempts: 0 });
    expect(item.platforms.linkedin?.note).toContain("only posts publicly");
  });

  it("holds an unlisted one the same way, and posts a public one", async () => {
    const { enqueueImagePost } = await import("@/lib/publisher/enqueue");
    const unlisted = await enqueueImagePost({
      ...copy,
      imagePaths: [await file("b.png")],
      publishAt: slotAt(22),
      platforms: ["linkedin"],
      visibility: "unlisted"
    });
    const open = await enqueueImagePost({
      ...copy,
      imagePaths: [await file("c.png")],
      publishAt: slotAt(23),
      platforms: ["linkedin"],
      visibility: "public"
    });
    expect(unlisted.platforms.linkedin?.status).toBe("manual");
    expect(open.platforms.linkedin?.status).toBe("pending");
  });

  it("holds a private video, and a long-form video (always private), but not a public short", async () => {
    const { enqueue } = await import("@/lib/publisher/enqueue");
    const base = { ...copy, platforms: ["linkedin" as const] };
    const hidden = await enqueue({ ...base, clipPath: await file("one.mp4"), publishAt: slotAt(24), visibility: "private" });
    const long = await enqueue({ ...base, clipPath: await file("two.mp4"), publishAt: slotAt(25), visibility: "public", format: "long" });
    const open = await enqueue({ ...base, clipPath: await file("three.mp4"), publishAt: slotAt(26), visibility: "public" });
    expect(hidden.platforms.linkedin?.status).toBe("manual");
    expect(long.platforms.linkedin?.status).toBe("manual");
    expect(open.platforms.linkedin?.status).toBe("pending");
  });

  it("holds only the LinkedIn leg of a private post that also goes to YouTube", async () => {
    const { enqueue } = await import("@/lib/publisher/enqueue");
    const item = await enqueue({
      ...copy,
      clipPath: await file("four.mp4"),
      publishAt: slotAt(27),
      platforms: ["youtube", "linkedin"],
      visibility: "private"
    });
    expect(item.platforms.linkedin?.status).toBe("manual");
    expect(item.platforms.youtube?.note ?? "").not.toContain("only posts publicly");
  });
});

describe("adding LinkedIn to a deck that is already booked", () => {
  it("books it as a post of its own, beside the Instagram and Facebook one", async () => {
    const { enqueueImagePost } = await import("@/lib/publisher/enqueue");
    const { publishQueue } = await import("@/lib/publisher/queue");
    const deck = [await file("d1.png"), await file("d2.png")];

    const meta = await enqueueImagePost({ ...copy, imagePaths: deck, publishAt: slotAt(28), platforms: ["instagram"], visibility: "public" });
    const linkedin = await enqueueImagePost({ ...copy, imagePaths: deck, publishAt: slotAt(29), platforms: ["linkedin"], visibility: "public" });

    expect(Object.keys(meta.platforms).sort()).toEqual(["facebook", "instagram"]);
    expect(Object.keys(linkedin.platforms)).toEqual(["linkedin"]);
    expect(linkedin.id).not.toBe(meta.id);
    expect((await publishQueue().list()).filter((entry) => [meta.id, linkedin.id].includes(entry.id))).toHaveLength(2);
  });

  it("works the other way round too", async () => {
    const { enqueueImagePost } = await import("@/lib/publisher/enqueue");
    const deck = [await file("e1.png")];
    await enqueueImagePost({ ...copy, imagePaths: deck, publishAt: slotAt(30), platforms: ["linkedin"], visibility: "public" });
    const meta = await enqueueImagePost({ ...copy, imagePaths: deck, publishAt: slotAt(31), platforms: ["instagram"], visibility: "public" });
    expect(Object.keys(meta.platforms).sort()).toEqual(["facebook", "instagram"]);
  });

  it("still refuses the same deck on LinkedIn twice, and on Instagram twice", async () => {
    const { enqueueImagePost } = await import("@/lib/publisher/enqueue");
    const deck = [await file("f1.png")];
    await enqueueImagePost({ ...copy, imagePaths: deck, publishAt: slotAt(32), platforms: ["linkedin"], visibility: "public" });
    await expect(
      enqueueImagePost({ ...copy, imagePaths: deck, publishAt: slotAt(33), platforms: ["linkedin"], visibility: "public" })
    ).rejects.toThrow(/already scheduled/);

    const other = [await file("g1.png")];
    await enqueueImagePost({ ...copy, imagePaths: other, publishAt: slotAt(34), platforms: ["instagram"], visibility: "public" });
    await expect(
      enqueueImagePost({ ...copy, imagePaths: other, publishAt: slotAt(35), platforms: ["instagram"], visibility: "public" })
    ).rejects.toThrow(/already scheduled/);
  });
});
