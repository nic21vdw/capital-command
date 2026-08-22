import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PublishQueue } from "@/lib/publisher/queue";
import { runDue } from "@/lib/publisher/runner";
import { MemoryQueueStore, testConfig, testItem } from "@/lib/publisher/test-helpers";
import { outstandingTiktokDrafts, remainingTiktokInboxUploads } from "@/lib/publisher/tiktokInbox";
import type { PlatformAdapter, PublishInput } from "@/lib/publisher/types";

/**
 * The wall this exists to stop hitting: every inbox upload leaves a draft that
 * only a tap in the TikTok app finishes, and TikTok refuses new uploads once
 * too many are waiting. The queue used to keep uploading into that refusal,
 * so the inbox filled faster than it was ever emptied.
 */

const NOW = new Date("2026-08-21T23:00:00.000Z");
let clipPath: string;

beforeAll(async () => {
  const dir = path.join(os.tmpdir(), `tiktok-inbox-test-${process.pid}`);
  await mkdir(dir, { recursive: true });
  clipPath = path.join(dir, "clip.mp4");
  await writeFile(clipPath, Buffer.alloc(1024, 1));
});

function inboxAdapter(): PlatformAdapter & { calls: PublishInput[] } {
  const calls: PublishInput[] = [];
  return {
    id: "tiktok",
    calls,
    configured: () => true,
    validateAuth: async () => undefined,
    buildPlan: (input) => ({
      platform: "tiktok",
      endpoint: "https://example.test/tiktok",
      payload: {},
      publishAtLocal: "local",
      publishAtUtc: input.item.publishAt,
      notes: []
    }),
    publish: async (input) => {
      calls.push(input);
      return { status: "scheduled", postId: `c${calls.length}`, detail: "sent to the TikTok inbox" };
    }
  };
}

const config = testConfig({
  platforms: ["tiktok"],
  tiktok: { ...testConfig().tiktok, inboxLimit: 3 }
});

function draft(id: string) {
  return testItem({
    id,
    clipPath,
    publishAt: "2026-08-20T11:30:00.000Z",
    platformIds: ["tiktok"],
    platforms: { tiktok: { status: "scheduled", attempts: 0, containerId: `v_inbox_${id}` } }
  });
}

describe("the TikTok inbox ceiling", () => {
  it("counts only the drafts still waiting on a tap", async () => {
    const queue = new PublishQueue(new MemoryQueueStore(), config);
    await queue.add(draft("waiting-0"));
    await queue.add(draft("waiting-1"));
    await queue.add(
      testItem({
        id: "already-posted",
        clipPath,
        publishAt: "2026-08-20T11:30:00.000Z",
        platformIds: ["tiktok"],
        platforms: { tiktok: { status: "published", attempts: 0, postId: "live" } }
      })
    );

    const items = await queue.list();
    expect(outstandingTiktokDrafts(items)).toBe(2);
    expect(remainingTiktokInboxUploads(items, config)).toBe(1);
  });

  it("uploads up to the ceiling and defers the rest, untouched", async () => {
    const queue = new PublishQueue(new MemoryQueueStore(), config);
    for (let i = 0; i < 5; i += 1) {
      await queue.add(
        testItem({
          id: `clip-${i}`,
          clipPath,
          // TikTok has no pre-scheduling, so every slot must already be due.
          publishAt: `2026-08-${16 + i}T11:30:00.000Z`,
          platformIds: ["tiktok"]
        })
      );
    }
    const tiktok = inboxAdapter();

    const report = await runDue(NOW, { config, queue, log: () => {}, adapters: { tiktok } });

    expect(tiktok.calls).toHaveLength(3);
    const deferred = report.outcomes.filter((outcome) => outcome.outcome === "deferred");
    expect(deferred).toHaveLength(2);
    expect(deferred[0]!.detail).toContain("waiting in your TikTok inbox");

    const untouched = await queue.get("clip-4");
    expect(untouched!.platforms.tiktok).toMatchObject({ status: "pending", attempts: 0 });
    expect(untouched!.platforms.tiktok!.claimedAt).toBeUndefined();
    expect(untouched!.platforms.tiktok!.error).toBeUndefined();
  });

  it("stops entirely once the inbox is already full", async () => {
    const queue = new PublishQueue(new MemoryQueueStore(), config);
    for (let i = 0; i < 3; i += 1) await queue.add(draft(`waiting-${i}`));
    await queue.add(
      testItem({ id: "fresh", clipPath, publishAt: "2026-08-21T11:30:00.000Z", platformIds: ["tiktok"] })
    );
    const tiktok = inboxAdapter();

    const report = await runDue(NOW, { config, queue, log: () => {}, adapters: { tiktok } });

    expect(tiktok.calls).toHaveLength(0);
    const deferred = report.outcomes.filter((outcome) => outcome.outcome === "deferred");
    expect(deferred.map((outcome) => outcome.itemId)).toEqual(["fresh"]);
    expect(deferred[0]!.detail).toContain("3 clips are already waiting");
  });

  it("never counts a Direct Post against the inbox — it leaves no draft", async () => {
    const queue = new PublishQueue(new MemoryQueueStore(), config);
    for (let i = 0; i < 3; i += 1) await queue.add(draft(`waiting-${i}`));
    await queue.add(
      testItem({
        id: "direct",
        clipPath,
        publishAt: "2026-08-21T11:30:00.000Z",
        platformIds: ["tiktok"],
        tiktok: { delivery: "direct", privacyLevel: "SELF_ONLY" }
      })
    );
    const tiktok = inboxAdapter();

    await runDue(NOW, { config, queue, log: () => {}, adapters: { tiktok } });

    expect(tiktok.calls.map((call) => call.item.id)).toEqual(["direct"]);
  });
});
