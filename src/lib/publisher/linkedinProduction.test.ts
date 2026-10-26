import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { LINKEDIN_KEYS } from "@/lib/publisher/linkedinKeys";
import { PublishQueue } from "@/lib/publisher/queue";
import { runDue } from "@/lib/publisher/runner";
import { MemoryQueueStore, testConfig, testItem } from "@/lib/publisher/test-helpers";
import type { PlatformAdapter, PublishInput } from "@/lib/publisher/types";

const PRODUCTION_PLATFORMS = "youtube,instagram,tiktok,facebook";
const NOW = new Date("2026-10-13T15:00:00.000Z");
let dir: string;
let picture: string;

beforeAll(async () => {
  dir = path.join(os.tmpdir(), `linkedin-production-${process.pid}`);
  await mkdir(dir, { recursive: true });
  picture = path.join(dir, "deck-1.png");
  await writeFile(picture, Buffer.alloc(64, 4));
});

beforeEach(async () => {
  await rm(dataPath("publisher-tokens.json"), { force: true });
  await rm(dataPath("platform-auth.json"), { force: true });
  vi.stubEnv("PUBLISH_ENABLED", "true");
  vi.stubEnv("PUBLISH_PLATFORMS", PRODUCTION_PLATFORMS);
  vi.resetModules();
});

afterEach(() => vi.unstubAllEnvs());

async function connectLinkedin() {
  vi.stubEnv("LINKEDIN_CLIENT_ID", "id");
  vi.stubEnv("LINKEDIN_CLIENT_SECRET", "secret");
  const { setCachedTokens } = await import("@/lib/publisher/tokens");
  await setCachedTokens({
    [LINKEDIN_KEYS.accessToken]: "li-access",
    [LINKEDIN_KEYS.accessExpiresAt]: String(Date.now() + 30 * 86_400_000),
    [LINKEDIN_KEYS.author]: "urn:li:person:abc",
    [LINKEDIN_KEYS.memberId]: "abc"
  });
}

describe("a connected LinkedIn with the platform list production has", () => {
  it("defers fresh post creation for stored media when the accepted-post budget is spent", async () => {
    const config = testConfig(); config.linkedin.dailyPostBudget = 0;
    const queue = new PublishQueue(new MemoryQueueStore(), config);
    const item = testItem({ id: "stored-media", publishAt: "2026-10-13T14:00:00.000Z", platformIds: ["linkedin"], mediaKind: "image", imagePaths: [picture], clipPath: picture, visibility: "public" });
    Object.assign(item.platforms.linkedin!, { containerId: "urn:li:image:existing", uploadedAt: "2026-10-12T14:00:00.000Z" });
    await queue.add(item);
    const publish = vi.fn();
    const linkedin: PlatformAdapter = { id: "linkedin", configured: () => true, validateAuth: async () => undefined, buildPlan: () => ({ platform: "linkedin", endpoint: "x", payload: {}, publishAtLocal: "", publishAtUtc: item.publishAt, notes: [] }), publish };
    const report = await runDue(NOW, { config, queue, log: () => {}, adapters: { linkedin } });
    expect(publish).not.toHaveBeenCalled();
    expect(report.outcomes).toEqual([expect.objectContaining({ platform: "linkedin", outcome: "deferred" })]);
  });
  it("counts as connected even though PUBLISH_PLATFORMS does not name it", async () => {
    await connectLinkedin();
    const { publisherConfig, configuredPlatforms } = await import("@/lib/publisher/config");
    const { accountIdConfigured } = await import("@/lib/publisher/accounts");
    expect(publisherConfig().platforms).toEqual(["youtube", "instagram", "tiktok", "facebook"]);

    expect(await accountIdConfigured("linkedin")).toBe(true);
    expect(await accountIdConfigured("linkedin", "linkedin-primary")).toBe(true);
    expect(configuredPlatforms()).not.toContain("linkedin");
  });

  it("is not connected without the app credentials or without a sign-in", async () => {
    const { accountIdConfigured } = await import("@/lib/publisher/accounts");
    expect(await accountIdConfigured("linkedin")).toBe(false);

    vi.stubEnv("LINKEDIN_CLIENT_ID", "id");
    vi.stubEnv("LINKEDIN_CLIENT_SECRET", "secret");
    expect(await accountIdConfigured("linkedin")).toBe(false);
  });

  it("leaves the other platforms exactly as they were", async () => {
    await connectLinkedin();
    vi.stubEnv("TIKTOK_CLIENT_KEY", "k");
    vi.stubEnv("TIKTOK_CLIENT_SECRET", "s");
    vi.stubEnv("PUBLISH_PLATFORMS", "youtube,instagram,facebook");
    const { accountIdConfigured } = await import("@/lib/publisher/accounts");
    expect(await accountIdConfigured("tiktok")).toBe(false);
    expect(await accountIdConfigured("linkedin")).toBe(true);
  });

  it("books a picture post as pending, not as a manual reminder", async () => {
    await connectLinkedin();
    const { enqueueImagePost } = await import("@/lib/publisher/enqueue");
    const item = await enqueueImagePost({
      imagePaths: [picture],
      publishAt: `${new Date(Date.now() + 25 * 86_400_000).toISOString().slice(0, 10)}T12:30`,
      title: "Deck",
      caption: "A deck",
      hashtags: ["#ai"],
      platforms: ["linkedin"],
      visibility: "public"
    });
    expect(item.platforms.linkedin?.status).toBe("pending");
  });

  it("shows the LinkedIn account as connected, so the Uploading Center tab appears", async () => {
    await connectLinkedin();
    const { GET } = await import("@/app/api/publish/accounts/route");
    const body = (await (await GET()).json()) as { accounts: Array<{ id: string; platform: string; connected: boolean }> };
    expect(body.accounts.find((account) => account.id === "linkedin-primary")).toMatchObject({ platform: "linkedin", connected: true });
  });

  it("lets the runner post a LinkedIn leg instead of failing it as not configured", async () => {
    const config = testConfig({ platforms: ["youtube", "instagram", "tiktok", "facebook"] });
    const queue = new PublishQueue(new MemoryQueueStore(), config);
    await queue.add(
      testItem({
        id: "deck",
        publishAt: "2026-10-13T14:00:00.000Z",
        platformIds: ["linkedin"],
        mediaKind: "image",
        imagePaths: [picture],
        clipPath: picture,
        visibility: "public"
      })
    );
    const calls: PublishInput[] = [];
    const linkedin: PlatformAdapter = {
      id: "linkedin",
      configured: () => true,
      validateAuth: async () => undefined,
      buildPlan: (input) => ({ platform: "linkedin", endpoint: "x", payload: {}, publishAtLocal: "", publishAtUtc: input.item.publishAt, notes: [] }),
      publish: async (input) => {
        calls.push(input);
        return { status: "published", postId: "urn:li:share:1" };
      }
    };

    const report = await runDue(NOW, { config, queue, log: () => {}, adapters: { linkedin } });

    expect(calls).toHaveLength(1);
    expect(report.outcomes).toEqual([expect.objectContaining({ platform: "linkedin", outcome: "published" })]);
  });
});
