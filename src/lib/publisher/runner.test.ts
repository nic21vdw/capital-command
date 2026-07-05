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
  behave: (input: PublishInput) => Promise<PostResult>
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
    }
  };
}

function setup() {
  const config = testConfig();
  const queue = new PublishQueue(new MemoryQueueStore(), config);
  const logs: string[] = [];
  const log = (line: string) => logs.push(line);
  return { config, queue, logs, log };
}

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
