import { beforeEach, describe, expect, it, vi } from "vitest";
import { threadsTick } from "@/lib/threads/daily";
import { threadsConfig } from "@/lib/threads/config";

const mocks = vi.hoisted(() => ({ runDue: vi.fn(), recordAutomationOutcome: vi.fn(), isAutomationPaused: vi.fn() }));
vi.mock("@/lib/threads/runner", () => ({ runDue: mocks.runDue }));
vi.mock("@/lib/automations/store", () => ({
  recordAutomationOutcome: mocks.recordAutomationOutcome,
  isAutomationPaused: mocks.isAutomationPaused
}));

const now = new Date("2026-10-02T15:00:00Z");
beforeEach(() => {
  mocks.recordAutomationOutcome.mockReset().mockResolvedValue(undefined);
  mocks.isAutomationPaused.mockReset().mockResolvedValue(false);
  mocks.runDue.mockReset();
});

describe("Threads worker outcome includes exposure replies", () => {
  it("flags queue persistence failure even when no publication was attempted", async () => {
    mocks.runDue.mockResolvedValue({ ran: now.toISOString(), published: 0, failed: 0, skipped: 0, outcomes: [], dryRun: false,
      persistenceError: "Disk write failed", note: "The Threads queue could not be saved. Delivery stopped." });
    await threadsTick({ now, config: { ...threadsConfig(), enabled: false }, log: () => undefined });
    expect(mocks.recordAutomationOutcome).toHaveBeenCalledWith("threads", expect.objectContaining({
      status: "failed", detail: expect.stringContaining("Delivery stopped")
    }));
  });

  it.each([{ failed: 1, retrying: 0 }, { failed: 0, retrying: 1 }])("requires attention when replies fail or retry: %j", async (replyCounts) => {
    mocks.runDue.mockResolvedValue({ ran: now.toISOString(), published: 2, failed: 0, skipped: 0, outcomes: [], dryRun: false,
      replies: { published: 0, skipped: 0, outcomes: [], ...replyCounts } });
    await threadsTick({ now, config: { ...threadsConfig(), enabled: false }, log: () => undefined });
    expect(mocks.recordAutomationOutcome).toHaveBeenCalledWith("threads", expect.objectContaining({
      status: "failed", detail: expect.stringContaining(`${replyCounts.failed} reply failures, ${replyCounts.retrying} replies waiting to retry`)
    }));
  });

  it("records confirmed replies separately from parent publication", async () => {
    mocks.runDue.mockResolvedValue({ ran: now.toISOString(), published: 0, failed: 0, skipped: 0, outcomes: [], dryRun: false,
      replies: { published: 3, failed: 0, retrying: 0, skipped: 0, outcomes: [] } });
    await threadsTick({ now, config: { ...threadsConfig(), enabled: false }, log: () => undefined });
    expect(mocks.recordAutomationOutcome).toHaveBeenCalledWith("threads", expect.objectContaining({
      status: "completed", detail: expect.stringContaining("0 posts published, 0 post failures. 3 follow-up replies published")
    }));
  });
});
