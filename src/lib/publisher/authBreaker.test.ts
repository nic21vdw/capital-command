import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { AUTH_PROBE_MINUTES, readAuthStates } from "@/lib/platform-health/store";
import { addAccount, primaryAccountId, youtubeRefreshTokenKey } from "@/lib/publisher/accounts";
import { PermanentError } from "@/lib/publisher/http";
import { PublishQueue } from "@/lib/publisher/queue";
import { runDue } from "@/lib/publisher/runner";
import { MemoryQueueStore, testConfig, testItem } from "@/lib/publisher/test-helpers";
import { setCachedToken } from "@/lib/publisher/tokens";
import type { PlatformAdapter, PlatformId, PostResult, PublishInput } from "@/lib/publisher/types";

vi.mock("@/lib/automations/store", () => ({
  isAutomationPaused: vi.fn(async () => false),
  recordAutomationOutcome: vi.fn(async () => undefined)
}));
vi.mock("@/lib/automations/history", () => ({ recordAutomationEventSafely: vi.fn(async () => {}) }));

const DUE = new Date("2026-07-10T22:31:00.000Z");
const MINUTE = 60_000;
const META_190 =
  'Instagram container create failed (HTTP 400): {"error":{"message":"Error validating access token: Session has expired","type":"OAuthException","code":190}}';
let clipPath: string;

beforeAll(async () => {
  const dir = path.join(os.tmpdir(), `publisher-auth-test-${process.pid}`);
  await mkdir(dir, { recursive: true });
  clipPath = path.join(dir, "clip.mp4");
  await writeFile(clipPath, Buffer.alloc(1024, 1));
});

beforeEach(async () => {
  await rm(dataPath("platform-auth.json"), { force: true });
  await rm(dataPath("social-accounts.json"), { force: true });
  await rm(dataPath("publisher-tokens.json"), { force: true });
});

function adapter(id: PlatformId, behave: (input: PublishInput) => Promise<PostResult>): PlatformAdapter & { calls: PublishInput[] } {
  const calls: PublishInput[] = [];
  return {
    id,
    calls,
    configured: () => true,
    validateAuth: async () => undefined,
    buildPlan: (input) => ({
      platform: id,
      endpoint: `https://example.test/${id}`,
      payload: { title: input.item.title },
      publishAtLocal: "local",
      publishAtUtc: input.item.publishAt,
      notes: []
    }),
    publish: async (input) => {
      calls.push(input);
      return behave(input);
    }
  };
}

const expired = () =>
  adapter("instagram", async () => {
    throw new PermanentError(META_190);
  });
const working = (id: PlatformId) => adapter(id, async () => ({ status: "published", postId: `${id}-post` }));

async function board(platformIds: PlatformId[], count: number, config = testConfig()) {
  const queue = new PublishQueue(new MemoryQueueStore(), config);
  for (let index = 0; index < count; index += 1) {
    await queue.add(testItem({ id: `item${index}`, clipPath, platformIds, visibility: "public" }));
  }
  return { queue, config };
}

async function youtubeBoard() {
  const config = testConfig({ platforms: ["youtube"] });
  const clips = await addAccount("youtube", "Clips channel");
  await setCachedToken(youtubeRefreshTokenKey(clips.id), "clips-refresh-1");
  const queue = new PublishQueue(new MemoryQueueStore(), config);
  const rows: Array<[string, string | undefined]> = [
    ["main1", undefined],
    ["clips1", clips.id],
    ["main2", undefined],
    ["clips2", clips.id]
  ];
  for (const [id, accountId] of rows) {
    await queue.add(testItem({ id, clipPath, platformIds: ["youtube"], visibility: "public", accountId }));
  }
  return { queue, config, clips };
}

const mainYoutubeExpired = () =>
  adapter("youtube", async (input) => {
    if (!input.item.accountId) {
      throw new PermanentError("YouTube connection expired or was revoked. Reconnect YouTube to resume the upload automatically.");
    }
    return { status: "published", postId: `yt-${input.item.id}` };
  });

const log = () => undefined;

describe("the publisher auth breaker", () => {
  it("stops sending to a platform after its first auth failure, but not the other platforms", async () => {
    const { queue, config } = await board(["instagram", "tiktok"], 3);
    const instagram = expired();
    const tiktok = working("tiktok");

    const report = await runDue(DUE, { queue, config, log, adapters: { instagram, tiktok } });

    expect(instagram.calls).toHaveLength(1);
    expect(tiktok.calls).toHaveLength(3);
    expect(report.outcomes.filter((entry) => entry.platform === "instagram")).toEqual([
      expect.objectContaining({ platform: "instagram", outcome: "deferred" })
    ]);
  });

  it("keeps a second account on the same platform posting while the first one's token is dead", async () => {
    const { queue, config, clips } = await youtubeBoard();
    const youtube = mainYoutubeExpired();

    const report = await runDue(DUE, { queue, config, log, adapters: { youtube } });

    expect(youtube.calls.map((call) => call.item.id).sort()).toEqual(["clips1", "clips2", "main1"]);
    expect(report.outcomes.filter((entry) => entry.outcome === "published").map((entry) => entry.itemId).sort()).toEqual(["clips1", "clips2"]);
    expect(Object.keys(await readAuthStates())).toEqual([`youtube:${primaryAccountId("youtube")}`]);
    expect((await queue.get("main2"))!.platforms.youtube).toMatchObject({ status: "pending", attempts: 0 });
    expect((await queue.get("clips1"))!.accountId).toBe(clips.id);
  });

  it("does not fail or spend the retries of the item that hit it, or of the ones behind it", async () => {
    const { queue, config } = await board(["instagram"], 3);

    await runDue(DUE, { queue, config, log, adapters: { instagram: expired() } });

    for (const id of ["item0", "item1", "item2"]) {
      const state = (await queue.get(id))!.platforms.instagram!;
      expect(state).toMatchObject({ status: "pending", attempts: 0 });
      expect(state.claimedAt).toBeUndefined();
      expect(state.nextAttemptAt).toBeUndefined();
    }
    expect((await queue.get("item0"))!.platforms.instagram!.error).toContain("Session has expired");
  });

  it("records the account, when it broke, why, and the fix link, naming an added account by its label", async () => {
    const { queue, config, clips } = await youtubeBoard();
    const youtube = adapter("youtube", async (input) => {
      if (input.item.accountId === clips.id) throw new PermanentError("YouTube token refresh failed (HTTP 400): invalid_grant");
      return { status: "published", postId: `yt-${input.item.id}` };
    });

    await runDue(DUE, { queue, config, log, adapters: { youtube } });

    const states = await readAuthStates();
    expect(Object.keys(states)).toEqual([`youtube:${clips.id}`]);
    expect(states[`youtube:${clips.id}`]).toMatchObject({
      platform: "youtube",
      accountId: clips.id,
      accountLabel: "Clips channel",
      since: DUE.toISOString(),
      reason: expect.stringContaining("invalid_grant"),
      fixUrl: "/settings#accounts"
    });
  });

  it("leaves the primary account unnamed so the banner says just the platform", async () => {
    const { queue, config } = await board(["instagram"], 1);

    await runDue(DUE, { queue, config, log, adapters: { instagram: expired() } });

    expect((await readAuthStates())[`instagram:${primaryAccountId("instagram")}`]).toMatchObject({ accountLabel: null });
  });

  it("sends nothing for a broken account on the next run while its token is unchanged", async () => {
    const { queue, config } = await board(["instagram"], 2);
    await runDue(DUE, { queue, config, log, adapters: { instagram: expired() } });

    const later = working("instagram");
    await runDue(new Date(DUE.getTime() + 5 * MINUTE), { queue, config, log, adapters: { instagram: later } });

    expect(later.calls).toHaveLength(0);
  });

  it("holds only the broken account on the next run", async () => {
    const { queue, config } = await youtubeBoard();
    await runDue(DUE, { queue, config, log, adapters: { youtube: mainYoutubeExpired() } });
    const later = mainYoutubeExpired();

    await runDue(new Date(DUE.getTime() + 5 * MINUTE), { queue, config, log, adapters: { youtube: later } });

    expect(later.calls).toHaveLength(0);
    expect((await queue.get("clips2"))!.platforms.youtube?.status).toBe("published");
  });

  it("makes one trial call after the wait, and clears the state when it works", async () => {
    const { queue, config } = await board(["instagram"], 2);
    await runDue(DUE, { queue, config, log, adapters: { instagram: expired() } });

    const later = working("instagram");
    await runDue(new Date(DUE.getTime() + (AUTH_PROBE_MINUTES + 1) * MINUTE), { queue, config, log, adapters: { instagram: later } });

    expect(later.calls).toHaveLength(2);
    expect(await readAuthStates()).toEqual({});
  });

  it("goes straight back to work when the token changes", async () => {
    const { queue, config } = await board(["instagram"], 2);
    await runDue(DUE, { queue, config, log, adapters: { instagram: expired() } });

    const replaced = testConfig({ instagram: { ...config.instagram, accessToken: "ig-token-renewed" } });
    const later = working("instagram");
    await runDue(new Date(DUE.getTime() + MINUTE), { queue, config: replaced, log, adapters: { instagram: later } });

    expect(later.calls).toHaveLength(2);
    expect(await readAuthStates()).toEqual({});
  });

  it("lifts the hold on an added account when its own token is replaced", async () => {
    const { queue, config, clips } = await youtubeBoard();
    const clipsExpired = adapter("youtube", async (input) => {
      if (input.item.accountId === clips.id) throw new PermanentError("YouTube token refresh failed (HTTP 400): invalid_grant");
      return { status: "published", postId: `yt-${input.item.id}` };
    });
    await runDue(DUE, { queue, config, log, adapters: { youtube: clipsExpired } });
    await setCachedToken(youtubeRefreshTokenKey(clips.id), "clips-refresh-2");

    const later = working("youtube");
    await runDue(new Date(DUE.getTime() + MINUTE), { queue, config, log, adapters: { youtube: later } });

    expect(later.calls.map((call) => call.item.id)).toContain("clips2");
    expect(await readAuthStates()).toEqual({});
  });

  it("lets Publish now try a broken account anyway", async () => {
    const { queue, config } = await board(["instagram"], 1);
    await runDue(DUE, { queue, config, log, adapters: { instagram: expired() } });

    const manual = working("instagram");
    await runDue(new Date(DUE.getTime() + MINUTE), { queue, config, log, itemId: "item0", force: true, adapters: { instagram: manual } });

    expect(manual.calls).toHaveLength(1);
    expect(await readAuthStates()).toEqual({});
  });

  it("still fails an item whose error is not about the token", async () => {
    const { queue, config } = await board(["instagram"], 1);
    const rejecting = adapter("instagram", async () => {
      throw new PermanentError("Instagram container create failed (HTTP 400): caption too long");
    });

    const report = await runDue(DUE, { queue, config, log, adapters: { instagram: rejecting } });

    expect(report.outcomes[0].outcome).toBe("failed");
    expect((await queue.get("item0"))!.platforms.instagram).toMatchObject({ status: "failed", attempts: 1 });
    expect(await readAuthStates()).toEqual({});
  });
});
