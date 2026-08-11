import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PublishQueue } from "@/lib/publisher/queue";
import { remainingYoutubeUploads } from "@/lib/publisher/quota";
import { runDue } from "@/lib/publisher/runner";
import { MemoryQueueStore, testConfig, testItem } from "@/lib/publisher/test-helpers";
import type { PlatformAdapter, PlatformId, PublishInput } from "@/lib/publisher/types";

/**
 * The lockout this exists to prevent: a YouTube item is due the moment it is
 * queued (the upload happens now, YouTube publishes it at its slot), so a batch
 * booked across three weeks used to send every file in one run — which is how a
 * morning's booking spent the whole day's upload allowance and locked the
 * channel out.
 */

const NOW = new Date("2026-08-11T13:00:00.000Z");
let clipPath: string;

beforeAll(async () => {
  const dir = path.join(os.tmpdir(), `publisher-cap-test-${process.pid}`);
  await mkdir(dir, { recursive: true });
  clipPath = path.join(dir, "clip.mp4");
  await writeFile(clipPath, Buffer.alloc(1024, 1));
});

function countingAdapter(id: PlatformId): PlatformAdapter & { calls: PublishInput[] } {
  const calls: PublishInput[] = [];
  return {
    id,
    calls,
    configured: () => true,
    validateAuth: async () => undefined,
    buildPlan: (input) => ({
      platform: id,
      endpoint: `https://example.test/${id}`,
      payload: {},
      publishAtLocal: "local",
      publishAtUtc: input.item.publishAt,
      notes: []
    }),
    publish: async (input) => {
      calls.push(input);
      return { status: "scheduled", postId: `v${calls.length}`, detail: "scheduled on YouTube" };
    }
  };
}

const config = testConfig({
  platforms: ["youtube"],
  youtube: { ...testConfig().youtube, dailyUploadBudget: 3 }
});

describe("the day's YouTube upload allowance", () => {
  it("uploads up to the budget and defers the rest, untouched", async () => {
    const queue = new PublishQueue(new MemoryQueueStore(), config);
    for (let i = 0; i < 6; i += 1) {
      await queue.add(
        testItem({
          id: `clip-${i}`,
          clipPath,
          // Slots across the next three weeks — all of them upload today.
          publishAt: `2026-08-${12 + i}T11:30:00.000Z`,
          platformIds: ["youtube"]
        })
      );
    }
    const youtube = countingAdapter("youtube");

    const report = await runDue(NOW, { config, queue, log: () => {}, adapters: { youtube } });

    expect(youtube.calls).toHaveLength(3);
    const deferred = report.outcomes.filter((outcome) => outcome.outcome === "deferred");
    expect(deferred).toHaveLength(3);
    // The soonest slots are the ones that go up — `due` is ordered by slot.
    expect(youtube.calls.map((call) => call.item.id)).toEqual(["clip-0", "clip-1", "clip-2"]);
    expect(deferred.map((outcome) => outcome.itemId)).toEqual(["clip-3", "clip-4", "clip-5"]);

    // Deferred is not a failure: nothing is claimed, nothing is counted as an
    // attempt, so the next run after the reset sends them as if new.
    const untouched = await queue.get("clip-5");
    expect(untouched!.platforms.youtube).toMatchObject({ status: "pending", attempts: 0 });
    expect(untouched!.platforms.youtube!.claimedAt).toBeUndefined();
    expect(untouched!.platforms.youtube!.error).toBeUndefined();
  });

  it("counts what today already sent, so a second run does not top the day up", async () => {
    const queue = new PublishQueue(new MemoryQueueStore(), config);
    // Two uploads already stamped today (13:00Z is 06:00 in the quota's Pacific
    // reset zone, so the same calendar day there).
    for (let i = 0; i < 2; i += 1) {
      await queue.add(
        testItem({
          id: `done-${i}`,
          clipPath,
          publishAt: "2026-08-12T11:30:00.000Z",
          platformIds: ["youtube"],
          platforms: {
            youtube: { status: "scheduled", attempts: 1, uploadedAt: "2026-08-11T12:00:00.000Z", postId: `old${i}` }
          }
        })
      );
    }
    for (let i = 0; i < 3; i += 1) {
      await queue.add(
        testItem({ id: `fresh-${i}`, clipPath, publishAt: `2026-08-${13 + i}T11:30:00.000Z`, platformIds: ["youtube"] })
      );
    }
    const youtube = countingAdapter("youtube");

    expect(remainingYoutubeUploads(await queue.list(), NOW, config)).toBe(1);
    await runDue(NOW, { config, queue, log: () => {}, adapters: { youtube } });
    expect(youtube.calls).toHaveLength(1);
  });

  it("never counts a resume against the day — the bytes already went", async () => {
    const queue = new PublishQueue(new MemoryQueueStore(), config);
    // Uploaded on a previous day and awaiting its slot flip: finalize, not upload.
    await queue.add(
      testItem({
        id: "flip",
        clipPath,
        publishAt: "2026-08-11T10:00:00.000Z",
        platformIds: ["youtube"],
        platforms: { youtube: { status: "scheduled", attempts: 1, postId: "vOld", uploadedAt: "2026-08-09T10:00:00.000Z" } }
      })
    );
    for (let i = 0; i < 4; i += 1) {
      await queue.add(
        testItem({ id: `fresh-${i}`, clipPath, publishAt: `2026-08-${13 + i}T11:30:00.000Z`, platformIds: ["youtube"] })
      );
    }
    const youtube = countingAdapter("youtube");
    let finalized = 0;
    youtube.finalize = async () => {
      finalized += 1;
      return { status: "published", postId: "vOld", detail: "verified public" };
    };

    await runDue(NOW, { config, queue, log: () => {}, adapters: { youtube } });

    expect(finalized).toBe(1);
    expect(youtube.calls).toHaveLength(3);
  });
});
