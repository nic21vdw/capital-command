import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewPolicyPath } from "@/lib/publisher/approvalStore";
import { syncDueToBuffer } from "@/lib/publisher/buffer";
import { TransientError } from "@/lib/publisher/http";
import { PublishQueue } from "@/lib/publisher/queue";
import { runDue } from "@/lib/publisher/runner";
import { MemoryQueueStore, jsonResponse, mockFetchRoutes, testConfig, testItem } from "@/lib/publisher/test-helpers";
import type { PlatformAdapter, PlatformId, PostResult, PublishInput } from "@/lib/publisher/types";

const DUE = new Date("2026-07-10T22:31:00.000Z");
let clipPath: string;

beforeAll(async () => {
  const dir = path.join(os.tmpdir(), `approval-runner-test-${process.pid}`);
  await mkdir(dir, { recursive: true });
  clipPath = path.join(dir, "clip.mp4");
  await writeFile(clipPath, Buffer.alloc(1024, 1));
});

async function setPolicy(policy: Record<string, string>) {
  await mkdir(path.dirname(reviewPolicyPath()), { recursive: true });
  await writeFile(reviewPolicyPath(), JSON.stringify(policy), "utf8");
}

beforeEach(async () => {
  await rm(reviewPolicyPath(), { force: true });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(reviewPolicyPath(), { force: true });
});

function fakeAdapter(
  id: PlatformId,
  behave: (input: PublishInput) => Promise<PostResult> = async () => ({ status: "published", postId: `${id}-1` }),
  finalize?: PlatformAdapter["finalize"]
): PlatformAdapter & { calls: PublishInput[] } {
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
    },
    finalize
  };
}

function setup() {
  const config = testConfig({ platforms: ["youtube", "instagram", "tiktok", "facebook"] });
  const queue = new PublishQueue(new MemoryQueueStore(), config);
  const logs: string[] = [];
  return { config, queue, logs, log: (line: string) => logs.push(line) };
}

async function scenario(withExplicitAutoFile: boolean) {
  if (withExplicitAutoFile) {
    await setPolicy({ youtube: "auto", instagram: "auto", tiktok: "auto", facebook: "auto", threads: "auto" });
  }
  const { queue, config, log } = setup();
  await queue.add(testItem({ id: "a", clipPath, platformIds: ["youtube", "instagram", "tiktok"] }));
  await queue.add(testItem({ id: "b", clipPath, publishAt: "2026-07-10T22:00:00.000Z", platformIds: ["instagram", "facebook"] }));
  const adapters = {
    youtube: fakeAdapter("youtube", async () => ({ status: "scheduled", postId: "yt-1" })),
    instagram: fakeAdapter("instagram"),
    tiktok: fakeAdapter("tiktok", async () => {
      throw new TransientError("tiktok is down");
    }),
    facebook: fakeAdapter("facebook")
  };
  const report = await runDue(DUE, { queue, config, log, adapters });
  return {
    outcomes: report.outcomes,
    items: JSON.parse(JSON.stringify(await queue.list())).map((item: { updatedAt?: string }) => ({ ...item, updatedAt: undefined })),
    calls: Object.fromEntries(Object.entries(adapters).map(([id, adapter]) => [id, adapter.calls.length]))
  };
}

describe("a policy of auto everywhere", () => {
  it("changes nothing against no policy at all", async () => {
    const without = await scenario(false);
    const withFile = await scenario(true);
    expect(withFile).toEqual(without);
    expect(without.outcomes.map((outcome) => `${outcome.platform}:${outcome.outcome}`).sort()).toEqual([
      "facebook:published",
      "instagram:published",
      "instagram:published",
      "tiktok:retrying",
      "youtube:scheduled"
    ]);
  });

  it("never stamps an approval on what it sends", async () => {
    const { items } = await scenario(true);
    expect(JSON.stringify(items)).not.toContain("approvedAt");
  });
});

describe("a channel set to hold", () => {
  it("is skipped by the runner without spending a retry", async () => {
    await setPolicy({ instagram: "hold" });
    const { queue, config, log, logs } = setup();
    const item = testItem({ id: "a", clipPath, platformIds: ["youtube", "instagram"] });
    await queue.add(item);
    const before = JSON.stringify((await queue.get("a"))!.platforms.instagram);
    const youtube = fakeAdapter("youtube");
    const instagram = fakeAdapter("instagram");

    for (let run = 0; run < 3; run += 1) {
      await runDue(DUE, { queue, config, log, adapters: { youtube, instagram } });
    }

    expect(instagram.calls).toHaveLength(0);
    expect(JSON.stringify((await queue.get("a"))!.platforms.instagram)).toBe(before);
    expect((await queue.get("a"))!.platforms.instagram).toEqual({ status: "pending", attempts: 0 });
    expect(youtube.calls).toHaveLength(1);
    expect(logs.some((line) => line.includes("held for approval 1"))).toBe(true);
  });

  it("is not claimed, so the lease stays free", async () => {
    await setPolicy({ youtube: "hold" });
    const { queue, config, log } = setup();
    await queue.add(testItem({ id: "a", clipPath, platformIds: ["youtube"] }));
    const youtube = fakeAdapter("youtube");

    await runDue(DUE, { queue, config, log, adapters: { youtube } });

    expect(youtube.calls).toHaveLength(0);
    expect((await queue.get("a"))!.platforms.youtube).toEqual({ status: "pending", attempts: 0 });
    expect(queue.duePlatforms((await queue.get("a"))!, DUE)).toEqual([]);
  });

  it("goes out on the next run once it is approved", async () => {
    await setPolicy({ instagram: "hold" });
    const { queue, config, log } = setup();
    await queue.add(testItem({ id: "a", clipPath, platformIds: ["instagram"] }));
    const instagram = fakeAdapter("instagram");
    await runDue(DUE, { queue, config, log, adapters: { instagram } });
    expect(instagram.calls).toHaveLength(0);
    expect((await queue.awaitingApproval()).map((entry) => `${entry.item.id}:${entry.platform}`)).toEqual(["a:instagram"]);

    const approved = (await queue.releaseLegs([{ id: "a", platform: "instagram" }], DUE)).approved;
    expect(approved).toBe(1);
    expect(await queue.awaitingApproval()).toEqual([]);

    const report = await runDue(DUE, { queue, config, log, adapters: { instagram } });
    expect(instagram.calls).toHaveLength(1);
    expect(report.outcomes.map((outcome) => outcome.outcome)).toEqual(["published"]);
    expect((await queue.get("a"))!.platforms.instagram).toMatchObject({ status: "published", approvedAt: DUE.toISOString() });
  });

  it("approves every held leg at once, or every held leg of one channel", async () => {
    await setPolicy({ instagram: "hold", tiktok: "hold" });
    const { queue } = setup();
    await queue.add(testItem({ id: "a", clipPath, platformIds: ["instagram", "tiktok"] }));
    await queue.add(testItem({ id: "b", clipPath, platformIds: ["instagram", "youtube"] }));
    expect(await queue.awaitingApproval()).toHaveLength(3);

    expect((await queue.releaseAwaiting(DUE, "tiktok")).approved).toBe(1);
    expect((await queue.awaitingApproval()).map((entry) => entry.platform)).toEqual(["instagram", "instagram"]);
    expect((await queue.releaseAwaiting(DUE)).approved).toBe(2);
    expect(await queue.awaitingApproval()).toEqual([]);
    expect((await queue.releaseAwaiting(DUE)).approved).toBe(0);
  });

  it("lets the owner's explicit Publish now through", async () => {
    await setPolicy({ instagram: "hold" });
    const { queue, config, log } = setup();
    await queue.add(testItem({ id: "a", clipPath, platformIds: ["instagram"] }));
    const instagram = fakeAdapter("instagram");

    const unforced = await runDue(DUE, { queue, config, log, itemId: "a", adapters: { instagram } });
    expect(unforced.outcomes).toEqual([]);
    expect(instagram.calls).toHaveLength(0);

    const forced = await runDue(DUE, { queue, config, log, itemId: "a", force: true, adapters: { instagram } });
    expect(forced.outcomes.map((outcome) => outcome.outcome)).toEqual(["published"]);
    expect(instagram.calls).toHaveLength(1);
  });

  it("never holds a video that is already on the platform", async () => {
    await setPolicy({ youtube: "hold", instagram: "hold" });
    const { queue, config, log } = setup();
    const item = testItem({ id: "a", clipPath, platformIds: ["youtube", "instagram"] });
    item.platforms.youtube = { status: "scheduled", attempts: 0, postId: "vid1", uploadedAt: "2026-07-10T10:00:00.000Z" };
    item.platforms.instagram = { status: "pending", attempts: 1, nextAttemptAt: "2026-07-10T22:00:00.000Z", error: "slow" };
    await queue.add(item);
    const finalized: string[] = [];
    const youtube = fakeAdapter("youtube", undefined, async (_item, state) => {
      finalized.push(state.postId ?? "");
      return { status: "published", postId: state.postId };
    });
    const instagram = fakeAdapter("instagram");

    await runDue(DUE, { queue, config, log, adapters: { youtube, instagram } });

    expect(finalized).toEqual(["vid1"]);
    expect(instagram.calls).toHaveLength(1);
  });

  it("leaves the long-form private hold exactly as it was", async () => {
    await setPolicy({ youtube: "hold" });
    const { queue } = setup();
    const long = testItem({ id: "long", clipPath, format: "long", platformIds: ["youtube"] });
    long.platforms.youtube = { status: "scheduled", attempts: 0, postId: "vid-long", uploadedAt: "2026-07-10T10:00:00.000Z" };
    await queue.add(long);
    expect(queue.duePlatforms((await queue.get("long"))!, DUE)).toEqual(["youtube"]);
  });
});

describe("Buffer and a held channel", () => {
  it("does not schedule a post into Buffer while a leg of it awaits approval", async () => {
    await setPolicy({ instagram: "hold" });
    const config = testConfig({
      buffer: { enabled: true, accessToken: "buf", profileIds: ["p1"], apiBase: "https://api.bufferapp.com/1", shortenLinks: true }
    });
    const queue = new PublishQueue(new MemoryQueueStore(), config);
    await queue.add(testItem({ id: "a", platformIds: ["youtube", "instagram"] }));
    const requests = mockFetchRoutes([
      { match: "/updates/create.json", respond: () => jsonResponse({ success: true, updates: [{ id: "u1" }] }) }
    ]);

    expect(await syncDueToBuffer(DUE, { queue, config })).toEqual([]);
    expect(requests).toHaveLength(0);

    await queue.releaseAwaiting(DUE);
    const outcomes = await syncDueToBuffer(DUE, { queue, config });
    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(["scheduled"]);
    expect(requests).toHaveLength(1);
  });
});
