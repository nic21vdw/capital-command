import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withFacebookAlongsideInstagram } from "@/lib/publisher/metaPairing";

/**
 * Enqueuing generates a title, a description and hashtags, and generating them
 * asks a model. Unmocked, this test made real HTTP calls to whichever free
 * provider was configured, so it failed whenever one of them was rate-limited
 * or down - `HTTP 429 FreeUsageLimitError`, `503 Endpoint is unavailable` - and
 * a suite that goes red because somebody else's free tier is busy teaches
 * everyone to ignore it. `runAi` answering null is the same path a machine with
 * no key takes: metadata falls back to the deterministic heuristic, which is
 * what this test wants anyway. It is about which platforms a queue item lands
 * on, not about what a model would have called it.
 */
vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  return { ...actual, aiConfigured: () => false, runAi: vi.fn(async () => null) };
});

vi.mock("@/lib/publisher/hosting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/publisher/hosting")>();
  return {
    ...actual,
    hostImages: vi.fn(async (paths: string[], itemId: string) =>
      paths.map((entry, index) => `publisher/media/${itemId}/${index}-${path.basename(entry)}`)
    )
  };
});

describe("Instagram brings Facebook with it", () => {
  it("adds the Page to an Instagram-only ask", () => {
    expect(withFacebookAlongsideInstagram(["instagram"])).toEqual(["instagram", "facebook"]);
  });

  it("leaves an ask that already has both alone", () => {
    expect(withFacebookAlongsideInstagram(["instagram", "facebook"])).toEqual(["instagram", "facebook"]);
  });

  it("keeps every other platform untouched", () => {
    expect(withFacebookAlongsideInstagram(["youtube", "tiktok"])).toEqual(["youtube", "tiktok"]);
  });

  it("counts the platform's primary account as the paired one", () => {
    expect(withFacebookAlongsideInstagram(["instagram"], "instagram-primary")).toEqual(["instagram", "facebook"]);
  });

  it("leaves an extra Instagram account on its own — no Page is paired with it", () => {
    expect(withFacebookAlongsideInstagram(["instagram"], "instagram-2")).toEqual(["instagram"]);
  });
});

describe("a scheduled Instagram post is scheduled to Facebook", () => {
  let dir: string;
  let picture: string;

  function dateKeyIn(days: number): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date(Date.now() + days * 86_400_000));
  }

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "meta-pairing-"));
    picture = path.join(dir, "slide.png");
    await writeFile(picture, Buffer.alloc(64, 7));

    vi.stubEnv("PUBLISH_ENABLED", "true");
    vi.stubEnv("PUBLISH_PLATFORMS", "instagram");
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

  it("puts both platforms on the one queue item", async () => {
    const { enqueueImagePost } = await import("@/lib/publisher/enqueue");
    const item = await enqueueImagePost({
      title: "A deck about agents",
      caption: "copy",
      imagePaths: [picture],
      publishAt: `${dateKeyIn(2)}T12:30`,
      platforms: ["instagram"]
    });
    expect(Object.keys(item.platforms).sort()).toEqual(["facebook", "instagram"]);
  });
});
