import { rm } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { readAutomationOutcome } from "@/lib/automations/store";
import { PublishQueue } from "@/lib/publisher/queue";
import { runDue } from "@/lib/publisher/runner";
import { MemoryQueueStore, testConfig } from "@/lib/publisher/test-helpers";

const buffer = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock("@/lib/publisher/buffer", () => ({ syncDueToBuffer: buffer.sync, validateBufferAuth: vi.fn() }));

beforeEach(async () => {
  await rm(dataPath("automations"), { recursive: true, force: true });
  buffer.sync.mockReset();
});

async function tick() {
  const config = testConfig({ platforms: [], buffer: { enabled: true, accessToken: "test", profileIds: ["test"], apiBase: "https://example.test", shortenLinks: false } });
  return runDue(new Date("2026-10-01T12:00:00.000Z"), { config, queue: new PublishQueue(new MemoryQueueStore(), config), log: () => undefined });
}

describe("publisher worker evidence", () => {
  it.each(["failed", "retrying", "manual"])("reports a Buffer-only %s outcome as requiring attention", async (outcome) => {
    buffer.sync.mockResolvedValue([{ itemId: "item", clip: "clip.mp4", outcome, detail: "Buffer needs attention" }]);
    await tick();
    expect(await readAutomationOutcome("publisher")).toMatchObject({ status: "failed", detail: expect.stringContaining("1 Buffer outcomes") });
  });

  it("retains a thrown Buffer pass failure without exposing the raw error", async () => {
    buffer.sync.mockRejectedValue(new Error("request contained secret-token"));
    const report = await tick();
    const saved = await readAutomationOutcome("publisher");
    expect(report.bufferError).toContain("Buffer pass failed");
    expect(saved?.status).toBe("failed");
    expect(saved?.detail).toContain("1 failures");
    expect(saved?.detail).not.toContain("secret-token");
  });

  it("records successful Buffer-only delivery as completed", async () => {
    buffer.sync.mockResolvedValue([{ itemId: "item", clip: "clip.mp4", outcome: "scheduled", detail: "Queued in Buffer" }]);
    await tick();
    expect(await readAutomationOutcome("publisher")).toMatchObject({ status: "completed", detail: expect.stringContaining("0 failures") });
  });
});
