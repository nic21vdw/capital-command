import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { CONNECTIONS, signInVerifiable } from "@/lib/publisher/connections";
import { buildGetStarted, connectionStatus, nextStep } from "@/lib/publisher/getStarted";
import { describeOAuthLanding } from "@/lib/publisher/oauthLanding";
import { LINKEDIN_KEYS } from "@/lib/publisher/linkedinKeys";
import { PublishQueue } from "@/lib/publisher/queue";
import { linkedinPostsToday, remainingLinkedinPosts } from "@/lib/publisher/quota";
import { remoteUrlFor } from "@/lib/publisher/remoteUrl";
import { runDue } from "@/lib/publisher/runner";
import { MemoryQueueStore, testConfig, testItem } from "@/lib/publisher/test-helpers";
import { PermanentError } from "@/lib/publisher/http";
import type { PlatformAdapter, PlatformId, PublishInput } from "@/lib/publisher/types";

const NOW = new Date("2026-10-13T15:00:00.000Z");
let dir: string;
let slidePaths: string[];
let clipPath: string;

beforeAll(async () => {
  dir = path.join(os.tmpdir(), `linkedin-wiring-${process.pid}`);
  await mkdir(dir, { recursive: true });
  slidePaths = [path.join(dir, "s1.png"), path.join(dir, "s2.png")];
  for (const file of slidePaths) await writeFile(file, Buffer.alloc(64, 5));
  clipPath = path.join(dir, "clip.mp4");
  await writeFile(clipPath, Buffer.alloc(64, 6));
});

beforeEach(async () => {
  await rm(dataPath("publisher-tokens.json"), { force: true });
  await rm(dataPath("platform-auth.json"), { force: true });
  vi.resetModules();
});

afterEach(() => vi.unstubAllEnvs());

function linkedinAdapterStub(publish: PlatformAdapter["publish"]): PlatformAdapter & { calls: PublishInput[] } {
  const calls: PublishInput[] = [];
  return {
    id: "linkedin",
    calls,
    configured: () => true,
    validateAuth: async () => undefined,
    buildPlan: (input) => ({
      platform: "linkedin",
      endpoint: "https://api.linkedin.com/rest/posts",
      payload: {},
      publishAtLocal: "local",
      publishAtUtc: input.item.publishAt,
      notes: []
    }),
    publish: async (input) => {
      calls.push(input);
      return publish(input);
    }
  };
}

const config = testConfig({ platforms: ["linkedin"] });

describe("LinkedIn in the platform lists", () => {
  it("is not in the default platform list, so nothing books to it until it is chosen", async () => {
    const { publisherConfig } = await import("@/lib/publisher/config");
    const { DEFAULT_PLATFORMS } = await import("@/lib/publisher/types");
    expect(DEFAULT_PLATFORMS).toEqual(["youtube", "instagram", "tiktok", "facebook"]);
    expect(publisherConfig().platforms).not.toContain("linkedin");
  });

  it("can be chosen with PUBLISH_PLATFORMS", async () => {
    vi.stubEnv("PUBLISH_PLATFORMS", "youtube,linkedin");
    const { publisherConfig } = await import("@/lib/publisher/config");
    expect(publisherConfig().platforms).toEqual(["youtube", "linkedin"]);
  });

  it("is configured only when the app credentials, a sign-in and an author are all there", async () => {
    vi.stubEnv("PUBLISH_PLATFORMS", "linkedin");
    const { configuredPlatforms, publisherConfig } = await import("@/lib/publisher/config");
    expect(configuredPlatforms(publisherConfig())).toEqual([]);

    vi.stubEnv("LINKEDIN_CLIENT_ID", "id");
    vi.stubEnv("LINKEDIN_CLIENT_SECRET", "secret");
    expect(configuredPlatforms(publisherConfig())).toEqual([]);

    const { setCachedTokens } = await import("@/lib/publisher/tokens");
    await setCachedTokens({ [LINKEDIN_KEYS.accessToken]: "t", [LINKEDIN_KEYS.author]: "urn:li:person:abc" });
    expect(configuredPlatforms(publisherConfig())).toEqual(["linkedin"]);
  });

  it("has a primary account like every other platform", async () => {
    const { listAccounts, primaryAccountId } = await import("@/lib/publisher/accounts");
    expect(primaryAccountId("linkedin")).toBe("linkedin-primary");
    expect((await listAccounts()).map((account) => account.id)).toContain("linkedin-primary");
  });
});

describe("booking to LinkedIn", () => {
  async function bookable() {
    vi.stubEnv("PUBLISH_ENABLED", "true");
    vi.stubEnv("PUBLISH_PLATFORMS", "linkedin");
    return (await import("@/lib/publisher/enqueue")).enqueueImagePost;
  }
  const slotAt = (days: number) => `${new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)}T12:30`;
  const slot = slotAt(21);

  it("takes a picture post with no media hosting, since LinkedIn gets the bytes directly", async () => {
    vi.stubEnv("LINKEDIN_CLIENT_ID", "id");
    vi.stubEnv("LINKEDIN_CLIENT_SECRET", "secret");
    const { setCachedTokens } = await import("@/lib/publisher/tokens");
    await setCachedTokens({ [LINKEDIN_KEYS.accessToken]: "t", [LINKEDIN_KEYS.author]: "urn:li:person:abc" });
    const enqueueImagePost = await bookable();

    const item = await enqueueImagePost({
      imagePaths: slidePaths,
      publishAt: slot,
      title: "Deck",
      caption: "A deck",
      hashtags: ["#ai"],
      visibility: "public",
      allowDuplicate: true
    });

    expect(Object.keys(item.platforms)).toEqual(["linkedin"]);
    expect(item.platforms.linkedin?.status).toBe("pending");
    expect(item.imageKeys).toBeUndefined();
  });

  it("refuses to book the same deck to LinkedIn twice, like every other platform", async () => {
    const enqueueImagePost = await bookable();
    const fresh = path.join(dir, "fresh-deck.png");
    await writeFile(fresh, Buffer.alloc(64, 9));
    const copy = { imagePaths: [fresh], title: "Deck", caption: "A deck", hashtags: ["#ai"] };
    const first = await enqueueImagePost({ ...copy, publishAt: slot });
    await expect(enqueueImagePost({ ...copy, publishAt: slotAt(22) })).rejects.toThrow(
      new RegExp(`already scheduled.*${first.id}`)
    );
  });

  it("saves a reminder rather than a post while LinkedIn is not connected", async () => {
    const enqueueImagePost = await bookable();
    const item = await enqueueImagePost({
      imagePaths: [slidePaths[0]],
      publishAt: slot,
      title: "One",
      caption: "One picture",
      hashtags: ["#ai"],
      visibility: "public",
      allowDuplicate: true
    });
    expect(item.platforms.linkedin?.status).toBe("manual");
    expect(item.platforms.linkedin?.note).toContain("LinkedIn isn't connected");
  });
});

describe("the publish runner and LinkedIn", () => {
  function imageItem(id: string, publishAt = "2026-10-13T14:00:00.000Z") {
    return testItem({
      id,
      publishAt,
      platformIds: ["linkedin"],
      mediaKind: "image",
      imagePaths: slidePaths,
      clipPath: slidePaths[0],
      visibility: "public"
    });
  }

  it("hands a picture post its local files without needing media hosting", async () => {
    const queue = new PublishQueue(new MemoryQueueStore(), config);
    await queue.add(imageItem("deck"));
    const stub = linkedinAdapterStub(async () => ({ status: "published", postId: "urn:li:share:1" }));

    const report = await runDue(NOW, { config, queue, log: () => {}, adapters: { linkedin: stub } });

    expect(report.outcomes).toEqual([expect.objectContaining({ platform: "linkedin", outcome: "published" })]);
    expect(stub.calls[0].images?.localPaths).toEqual(slidePaths);
    expect(stub.calls[0].images?.publicUrls).toEqual([]);
  });

  it("hands a video its local file", async () => {
    const queue = new PublishQueue(new MemoryQueueStore(), config);
    await queue.add(testItem({ id: "vid", clipPath, publishAt: "2026-10-13T14:00:00.000Z", platformIds: ["linkedin"] }));
    const stub = linkedinAdapterStub(async () => ({ status: "published", postId: "urn:li:ugcPost:2" }));

    await runDue(NOW, { config, queue, log: () => {}, adapters: { linkedin: stub } });

    expect(stub.calls[0].localPath).toBe(clipPath);
    expect((await queue.get("vid"))!.platforms.linkedin).toMatchObject({ status: "published", postId: "urn:li:ugcPost:2" });
  });

  it("still needs hosting for Instagram on the same picture post", async () => {
    const both = testConfig({ platforms: ["linkedin", "instagram"] });
    const queue = new PublishQueue(new MemoryQueueStore(), both);
    await queue.add({ ...imageItem("both"), platforms: { linkedin: { status: "pending", attempts: 0 }, instagram: { status: "pending", attempts: 0 } } });
    const stub = linkedinAdapterStub(async () => ({ status: "published", postId: "urn:li:share:3" }));
    const instagram = { ...linkedinAdapterStub(async () => ({ status: "published" as const, postId: "ig" })), id: "instagram" as PlatformId };

    const report = await runDue(NOW, { config: both, queue, log: () => {}, adapters: { linkedin: stub, instagram } });

    const byPlatform = Object.fromEntries(report.outcomes.map((outcome) => [outcome.platform, outcome]));
    expect(byPlatform.linkedin.outcome).toBe("published");
    expect(byPlatform.instagram.outcome).not.toBe("published");
    expect(byPlatform.instagram.detail).toContain("not hosted");
  });

  it("defers the posts past the day's budget without spending their attempts", async () => {
    const capped = testConfig({ platforms: ["linkedin"], linkedin: { ...config.linkedin, dailyPostBudget: 2 } });
    const queue = new PublishQueue(new MemoryQueueStore(), capped);
    for (let index = 0; index < 4; index += 1) await queue.add(imageItem(`deck-${index}`, `2026-10-13T1${index}:00:00.000Z`));
    const stub = linkedinAdapterStub(async (input) => ({ status: "published", postId: `urn:li:share:${input.item.id}` }));

    const report = await runDue(NOW, { config: capped, queue, log: () => {}, adapters: { linkedin: stub } });

    expect(stub.calls).toHaveLength(2);
    expect(report.outcomes.filter((outcome) => outcome.outcome === "deferred")).toHaveLength(2);
    const waiting = (await queue.list()).filter((item) => item.platforms.linkedin?.status === "pending");
    expect(waiting.map((item) => item.platforms.linkedin?.attempts)).toEqual([0, 0]);
  });

  it("counts a day by UTC, which is when LinkedIn's limits reset", () => {
    const stamped = (publishedAt: string) =>
      testItem({ platformIds: ["linkedin"], platforms: { linkedin: { status: "published", attempts: 1,
        postId: `urn:li:share:${Date.parse(publishedAt)}`, publishedAt, uploadedAt: "2026-10-01T14:00:00.000Z" } } });
    const items = [stamped("2026-10-13T00:30:00.000Z"), stamped("2026-10-12T23:30:00.000Z"), stamped("2026-10-13T14:00:00.000Z")];
    expect(linkedinPostsToday(items, NOW)).toBe(2);
    expect(remainingLinkedinPosts(items, NOW, config)).toBe(8);
  });

  it("does not spend the day's budget on a post that is only being resumed", async () => {
    const capped = testConfig({ platforms: ["linkedin"], linkedin: { ...config.linkedin, dailyPostBudget: 1 } });
    const queue = new PublishQueue(new MemoryQueueStore(), capped);
    await queue.add({
      ...imageItem("resume"),
      platforms: { linkedin: { status: "uploaded", attempts: 1, containerId: "urn:li:document:D", uploadedAt: "2026-10-13T10:00:00.000Z" } }
    });
    const stub = linkedinAdapterStub(async () => ({ status: "published", postId: "urn:li:share:9" }));

    await runDue(NOW, { config: capped, queue, log: () => {}, adapters: { linkedin: stub } });

    expect(stub.calls).toHaveLength(1);
  });

  it("holds the account and lists it as broken when LinkedIn answers 401", async () => {
    const { setCachedTokens } = await import("@/lib/publisher/tokens");
    await setCachedTokens({ [LINKEDIN_KEYS.accessToken]: "li-access" });
    const queue = new PublishQueue(new MemoryQueueStore(), config);
    await queue.add(imageItem("a", "2026-10-13T13:00:00.000Z"));
    await queue.add(imageItem("b", "2026-10-13T14:00:00.000Z"));
    const stub = linkedinAdapterStub(async () => {
      throw new PermanentError("LinkedIn post failed (HTTP 401): The token used in the request has been revoked by the user.");
    });

    const report = await runDue(NOW, { config, queue, log: () => {}, adapters: { linkedin: stub } });

    expect(stub.calls).toHaveLength(1);
    expect(report.outcomes.map((outcome) => outcome.outcome)).toEqual(["deferred"]);
    const { platformHealth } = await import("@/lib/platform-health/health");
    expect(await platformHealth(NOW)).toMatchObject({
      ok: false,
      broken: [expect.objectContaining({ platform: "linkedin", accountId: "linkedin-primary", displayName: "LinkedIn" })]
    });
    expect((await queue.get("a"))!.platforms.linkedin).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("never posts twice: a leg that already has a LinkedIn post id is only marked published", async () => {
    const queue = new PublishQueue(new MemoryQueueStore(), config);
    await queue.add({
      ...imageItem("done"),
      platforms: { linkedin: { status: "pending", attempts: 1, postId: "urn:li:share:77" } }
    });
    const stub = linkedinAdapterStub(async () => ({ status: "published", postId: "urn:li:share:new" }));

    await runDue(NOW, { config, queue, log: () => {}, adapters: { linkedin: stub } });

    expect(stub.calls).toHaveLength(0);
    expect((await queue.get("done"))!.platforms.linkedin).toMatchObject({ status: "published", postId: "urn:li:share:77" });
  });

  it("retries a 5xx and fails a 422 for good", async () => {
    const queue = new PublishQueue(new MemoryQueueStore(), config);
    await queue.add(imageItem("flaky", "2026-10-13T13:00:00.000Z"));
    await queue.add(imageItem("dupe", "2026-10-13T14:00:00.000Z"));
    const { TransientError } = await import("@/lib/publisher/http");
    const stub = linkedinAdapterStub(async (input) => {
      if (input.item.id === "flaky") throw new TransientError("LinkedIn post failed (HTTP 503): down");
      throw new PermanentError("LinkedIn post failed (HTTP 422): Content is a duplicate");
    });

    await runDue(NOW, { config, queue, log: () => {}, adapters: { linkedin: stub } });

    expect((await queue.get("flaky"))!.platforms.linkedin).toMatchObject({ status: "pending", attempts: 1 });
    expect((await queue.get("flaky"))!.platforms.linkedin!.nextAttemptAt).toBeTruthy();
    expect((await queue.get("dupe"))!.platforms.linkedin).toMatchObject({ status: "failed" });
  });
});

describe("the LinkedIn account card", () => {
  const linkedin = CONNECTIONS.find((connection) => connection.id === "linkedin")!;
  const phase = { loaded: true, loadFailed: false };

  it("asks for the two app credentials and signs in with OAuth", () => {
    expect(linkedin.fields.map((field) => field.name)).toEqual(["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"]);
    expect(linkedin.oauth).toEqual({ href: "/api/auth/linkedin", label: "Connect LinkedIn" });
    expect(signInVerifiable("linkedin")).toBe(true);
  });

  it("says what to set and where the steps are while the credentials are unset", () => {
    expect(linkedin.setup?.doc).toBe("docs/LINKEDIN_SETUP.md");
    expect(linkedin.setup?.whenUnset).toContain("LINKEDIN_CLIENT_ID");
    expect(linkedin.setup?.whenUnset).toContain("LINKEDIN_CLIENT_SECRET");
    expect(linkedin.setup?.whenUnset).toContain("docs/LINKEDIN_SETUP.md");
    expect(linkedin.setup?.href).toMatch(/^https:\/\/github\.com\/.+\/docs\/LINKEDIN_SETUP\.md$/);
    const state = { present: {}, connected: {} };
    expect(connectionStatus(linkedin, state, phase)).toBe("Not set up");
    expect(nextStep(linkedin, "Not set up", state)).toContain("LINKEDIN_CLIENT_ID");
    expect(nextStep(linkedin, "Not set up", state)).toContain("docs/LINKEDIN_SETUP.md");
  });

  it("moves from not set up to sign in needed to connected", () => {
    const present = { LINKEDIN_CLIENT_ID: true, LINKEDIN_CLIENT_SECRET: true };
    expect(connectionStatus(linkedin, { present: { LINKEDIN_CLIENT_ID: true }, connected: {} }, phase)).toBe("Finish setup");
    expect(connectionStatus(linkedin, { present, connected: {} }, phase)).toBe("Sign in needed");
    expect(connectionStatus(linkedin, { present, connected: { linkedin: true } }, phase)).toBe("Connected");
    expect(buildGetStarted({ present, connected: { linkedin: true } }, phase).connectedLabels).toContain("LinkedIn");
  });

  it("lands back on Settings with a success line after sign-in", () => {
    const landing = describeOAuthLanding(new URLSearchParams("connected=linkedin"));
    expect(landing).toMatchObject({ tone: "success", platform: "linkedin", title: "LinkedIn connected" });
    expect(landing?.detail).toContain("company page");
  });
});

describe("where a published LinkedIn post lives", () => {
  it("links the post URN once it is published", () => {
    expect(remoteUrlFor("linkedin", "urn:li:share:7001", "published")).toBe("https://www.linkedin.com/feed/update/urn:li:share:7001/");
    expect(remoteUrlFor("linkedin", "urn:li:ugcPost:9001", "published")).toBe("https://www.linkedin.com/feed/update/urn:li:ugcPost:9001/");
    expect(remoteUrlFor("linkedin", "urn:li:share:7001", "uploaded")).toBeNull();
    expect(remoteUrlFor("linkedin", "urn:li:share:../evil", "published")).toBeNull();
  });
});
