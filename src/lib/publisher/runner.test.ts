import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PermanentError, StillProcessingError, TransientError } from "@/lib/publisher/http";
import { PublishQueue } from "@/lib/publisher/queue";
import { runDue } from "@/lib/publisher/runner";
import { MemoryQueueStore, testConfig, testItem } from "@/lib/publisher/test-helpers";
import type { PlatformAdapter, PlatformId, PostResult, PublishInput } from "@/lib/publisher/types";

const DUE = new Date("2026-07-10T22:31:00.000Z");
let clipPath: string;

beforeAll(async () => {
  // The runner stats the clip file before publishing, so create a real one.
  const dir = path.join(os.tmpdir(), `publisher-test-${process.pid}`);
  await mkdir(dir, { recursive: true });
  clipPath = path.join(dir, "clip.mp4");
  await writeFile(clipPath, Buffer.alloc(1024, 1));
});

/** Adapter double that records calls and plays a scripted response. */
function fakeAdapter(
  id: PlatformId,
  behave: (input: PublishInput) => Promise<PostResult>,
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
  const config = testConfig();
  const queue = new PublishQueue(new MemoryQueueStore(), config);
  const logs: string[] = [];
  const log = (line: string) => logs.push(line);
  return { config, queue, logs, log };
}

describe("runDue — one schedule for every platform", () => {
  // The point of the mirror pass: a clip only ever scheduled on YouTube is
  // already on Instagram and Facebook before its slot arrives, without anyone
  // keeping a second calendar.
  it("puts the lead platform's upcoming slots onto the other platforms", async () => {
    const { queue, log } = setup();
    const config = testConfig({
      platforms: ["youtube", "instagram", "facebook"],
      mirror: { enabled: true, lead: "youtube", targets: ["instagram", "facebook"], mode: "match" }
    });
    const future = testItem({
      id: "future",
      clipPath,
      publishAt: "2026-07-20T15:00:00.000Z",
      visibility: "public",
      platformIds: ["youtube"]
    });
    await queue.add(future);

    await runDue(DUE, { config, queue, log, adapters: {} });

    const stored = await queue.get("future");
    expect(Object.keys(stored!.platforms).sort()).toEqual(["facebook", "instagram", "youtube"]);
    expect(stored!.platforms.instagram?.status).toBe("pending");
  });

  it("leaves slots that already passed alone", async () => {
    const { queue, log } = setup();
    const config = testConfig({
      platforms: ["youtube", "instagram"],
      mirror: { enabled: true, lead: "youtube", targets: ["instagram"], mode: "match" }
    });
    const past = testItem({
      id: "past",
      clipPath,
      publishAt: "2026-07-01T15:00:00.000Z",
      visibility: "public",
      platformIds: ["youtube"]
    });
    await queue.add(past);

    await runDue(DUE, { config, queue, log, adapters: { youtube: fakeAdapter("youtube", async () => ({ status: "scheduled" })) } });

    expect(Object.keys((await queue.get("past"))!.platforms)).toEqual(["youtube"]);
  });

  it("does nothing when the mirror is switched off", async () => {
    const { queue, log } = setup();
    const config = testConfig({ platforms: ["youtube", "instagram"] });
    await queue.add(
      testItem({ id: "future", clipPath, publishAt: "2026-07-20T15:00:00.000Z", visibility: "public", platformIds: ["youtube"] })
    );

    await runDue(DUE, { config, queue, log, adapters: {} });

    expect(Object.keys((await queue.get("future"))!.platforms)).toEqual(["youtube"]);
  });
});

describe("runDue", () => {
  it("publishes due platforms; one platform's failure does not block the others", async () => {
    const { config, queue, log } = setup();
    const item = testItem({ clipPath, publishAt: "2026-07-10T22:30:00.000Z" });
    await queue.add(item);

    const youtube = fakeAdapter("youtube", async () => ({ status: "scheduled", postId: "vid1" }));
    const instagram = fakeAdapter("instagram", async () => {
      throw new PermanentError("container rejected");
    });
    const tiktok = fakeAdapter("tiktok", async () => ({ status: "published", postId: "tt1" }));

    const report = await runDue(DUE, { config, queue, log, adapters: { youtube, instagram, tiktok } });

    expect(youtube.calls).toHaveLength(1);
    expect(instagram.calls).toHaveLength(1);
    expect(tiktok.calls).toHaveLength(1);
    expect(report.outcomes.map((o) => [o.platform, o.outcome])).toEqual([
      ["youtube", "scheduled"],
      ["instagram", "failed"],
      ["tiktok", "published"]
    ]);
    expect(item.platforms.instagram?.error).toContain("container rejected");
  });

  it("re-running publishes nothing that already succeeded (idempotency)", async () => {
    const { config, queue, log } = setup();
    const item = testItem({ clipPath, publishAt: "2026-07-10T22:30:00.000Z", platformIds: ["youtube", "tiktok"] });
    await queue.add(item);

    const youtube = fakeAdapter("youtube", async () => ({ status: "scheduled", postId: "vid1" }));
    const tiktok = fakeAdapter("tiktok", async () => ({ status: "published", postId: "tt1" }));

    await runDue(DUE, { config, queue, log, adapters: { youtube, tiktok } });
    const second = await runDue(new Date(DUE.getTime() + 60_000), { config, queue, log, adapters: { youtube, tiktok } });

    expect(youtube.calls).toHaveLength(1);
    expect(tiktok.calls).toHaveLength(1);
    expect(second.outcomes).toEqual([]);
  });

  it("finalizes a scheduled YouTube post once its slot time passes (no re-upload)", async () => {
    const { config, queue, log } = setup();
    const item = testItem({ clipPath, publishAt: "2026-07-10T22:30:00.000Z", platformIds: ["youtube"] });
    await queue.add(item);

    const finalizeCalls: string[] = [];
    const youtube = fakeAdapter(
      "youtube",
      async () => ({ status: "scheduled", postId: "vid1" }),
      async (_item, state) => {
        finalizeCalls.push(state.postId!);
        return { status: "published", postId: state.postId, detail: "set public" };
      }
    );

    // Before the slot: upload happens once and records "scheduled".
    const first = await runDue(new Date("2026-07-10T22:00:00.000Z"), { config, queue, log, adapters: { youtube } });
    expect(first.outcomes.map((o) => o.outcome)).toEqual(["scheduled"]);
    expect(finalizeCalls).toEqual([]);

    // After the slot: finalize verifies/forces the public flip, no re-upload.
    const second = await runDue(DUE, { config, queue, log, adapters: { youtube } });
    expect(youtube.calls).toHaveLength(1);
    expect(finalizeCalls).toEqual(["vid1"]);
    expect(second.outcomes.map((o) => o.outcome)).toEqual(["published"]);
    expect(item.platforms.youtube?.status).toBe("published");

    // Terminal now — a third run does nothing.
    const third = await runDue(new Date(DUE.getTime() + 60_000), { config, queue, log, adapters: { youtube } });
    expect(third.outcomes).toEqual([]);
    expect(finalizeCalls).toHaveLength(1);
  });

  it("records still-processing uploads and resumes them with the container id", async () => {
    const { config, queue, log } = setup();
    const item = testItem({ clipPath, publishAt: "2026-07-10T22:30:00.000Z", platformIds: ["tiktok"] });
    await queue.add(item);

    let attempt = 0;
    const tiktok = fakeAdapter("tiktok", async (input) => {
      attempt += 1;
      if (attempt === 1) throw new StillProcessingError("publish-9", "still processing");
      // The retry must see the saved handle so it resumes instead of re-uploading.
      expect(input.item.platforms.tiktok?.containerId).toBe("publish-9");
      return { status: "published", postId: "tt9" };
    });

    await runDue(DUE, { config, queue, log, adapters: { tiktok } });
    expect(item.platforms.tiktok?.status).toBe("uploaded");

    await runDue(new Date(DUE.getTime() + 60_000), { config, queue, log, adapters: { tiktok } });
    expect(item.platforms.tiktok?.status).toBe("published");
    expect(item.platforms.tiktok?.postId).toBe("tt9");
    expect(tiktok.calls).toHaveLength(2);
  });

  it("transient errors retry with backoff instead of failing permanently", async () => {
    const { config, queue, log } = setup();
    const item = testItem({ clipPath, publishAt: "2026-07-10T22:30:00.000Z", platformIds: ["instagram"] });
    await queue.add(item);

    const instagram = fakeAdapter("instagram", async () => {
      throw new TransientError("HTTP 500");
    });
    const report = await runDue(DUE, { config, queue, log, adapters: { instagram } });

    expect(report.outcomes[0].outcome).toBe("retrying");
    expect(item.platforms.instagram?.status).toBe("pending");
    expect(item.platforms.instagram?.nextAttemptAt).toBeTruthy();
  });

  it("dry run validates auth and builds plans without posting or mutating state", async () => {
    const { config, queue, log } = setup();
    const item = testItem({ clipPath, publishAt: "2026-07-10T22:30:00.000Z" });
    await queue.add(item);

    const youtube = fakeAdapter("youtube", async () => ({ status: "scheduled" }));
    const instagram = fakeAdapter("instagram", async () => ({ status: "published" }));
    const tiktok = fakeAdapter("tiktok", async () => ({ status: "published" }));

    const report = await runDue(DUE, { config, queue, log, dryRun: true, adapters: { youtube, instagram, tiktok } });

    expect(report.authChecks.every((check) => check.ok)).toBe(true);
    expect(report.plans).toHaveLength(3);
    expect(report.plans.every((plan) => plan.due)).toBe(true);
    expect(youtube.calls).toHaveLength(0);
    expect(instagram.calls).toHaveLength(0);
    expect(tiktok.calls).toHaveLength(0);
    expect(item.platforms.youtube?.status).toBe("pending");
  });

  it("does nothing when publishing is disabled", async () => {
    const { queue, log } = setup();
    const config = testConfig({ enabled: false });
    const item = testItem({ clipPath, publishAt: "2026-07-10T22:30:00.000Z", platformIds: ["youtube"] });
    await queue.add(item);

    const youtube = fakeAdapter("youtube", async () => ({ status: "scheduled" }));
    const report = await runDue(DUE, { config, queue, log, adapters: { youtube } });

    expect(youtube.calls).toHaveLength(0);
    expect(report.outcomes).toEqual([]);
  });
});
