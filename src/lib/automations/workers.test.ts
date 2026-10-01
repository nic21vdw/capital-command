import { rm } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { setAutomationPaused } from "@/lib/automations/store";
import { runDue as publishDue } from "@/lib/publisher/runner";
import { runDue as threadsDue } from "@/lib/threads/runner";
import { planTodaysBatch, threadsTick } from "@/lib/threads/daily";
import { threadsConfig } from "@/lib/threads/config";
import { runDailyScan } from "@/lib/ingest/run";
import { testConfig } from "@/lib/publisher/test-helpers";

const generate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/x-posts/daily", () => ({ ensureDailyPack: generate }));

beforeEach(async () => {
  await rm(dataPath("automations"), { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("worker pause enforcement", () => {
  it("stops the publisher before queue access, adapters, native preuploads or Buffer", async () => {
    await setAutomationPaused("publisher", true);
    const queue = { describe: vi.fn(), list: vi.fn() };
    const report = await publishDue(new Date("2026-10-01T15:00:00Z"), { config: testConfig(), queue: queue as never });
    expect(report.queue).toContain("paused");
    expect(report.outcomes).toEqual([]);
    expect(queue.describe).not.toHaveBeenCalled();
    expect(queue.list).not.toHaveBeenCalled();
  });

  it("stops Threads publishing before reading or mutating its queue", async () => {
    await setAutomationPaused("threads", true);
    const config = { ...threadsConfig(), accounts: [{ id: "primary", label: "Test", userId: "test", accessToken: "test-token", posts: "text" as const, offsetMinutes: 0 }] };
    const deps = { read: vi.fn(), write: vi.fn(), post: vi.fn() };
    const report = await threadsDue(new Date(), { config, deps });
    expect(report.note).toContain("paused");
    expect(deps.read).not.toHaveBeenCalled();
    expect(deps.write).not.toHaveBeenCalled();
    expect(deps.post).not.toHaveBeenCalled();
  });

  it("stops Threads planning and the daily tick before content generation", async () => {
    await setAutomationPaused("threads", true);
    const plan = await planTodaysBatch();
    const tick = await threadsTick();
    expect(plan.skipped).toContain("paused");
    expect(tick.run.note).toContain("paused");
    expect(generate).not.toHaveBeenCalled();
  });

  it("stops both CLI and in-process ingest at their shared entrypoint", async () => {
    await setAutomationPaused("ingest", true);
    await expect(runDailyScan()).rejects.toThrow("Channel ingest is paused");
  });
});
