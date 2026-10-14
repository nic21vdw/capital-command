import { beforeEach, describe, expect, it, vi } from "vitest";
import { threadsConfig } from "@/lib/threads/config";
import { threadsTick } from "@/lib/threads/daily";

const mocks = vi.hoisted(() => ({ runDue: vi.fn(), ensureDailyPack: vi.fn(), outcome: vi.fn() }));
vi.mock("@/lib/threads/runner", () => ({ runDue: mocks.runDue }));
vi.mock("@/lib/x-posts/daily", () => ({ ensureDailyPack: mocks.ensureDailyPack }));
vi.mock("@/lib/threads/state", () => ({ readThreadsState: async () => ({}), recordThreadsState: async () => {} }));
vi.mock("@/lib/automations/store", () => ({ isAutomationPaused: async () => false, recordAutomationOutcome: mocks.outcome }));
vi.mock("@/lib/threads/queue", async (original) => ({
  ...await original<typeof import("@/lib/threads/queue")>(),
  readQueue: async () => [],
  mutateQueue: async <T>(change: (rows: []) => { result: T }) => change([]).result
}));

beforeEach(() => {
  mocks.runDue.mockReset().mockResolvedValue({ ran: "2026-10-14T12:00:00Z", published: 1, failed: 0, skipped: 0, outcomes: [], dryRun: false });
  mocks.ensureDailyPack.mockReset();
  mocks.outcome.mockReset().mockResolvedValue(undefined);
});

describe("queued delivery before generation", () => {
  it("delivers queued posts before a slow writer and reports its eventual failure", async () => {
    let fail!: (error: Error) => void;
    mocks.ensureDailyPack.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
    const config = { ...threadsConfig(), enabled: true, timezone: "UTC", catchUp: false,
      accounts: [{ id: "primary", label: "Fixture", userId: "fixture-user", accessToken: "fixture-token", posts: "text" as const, offsetMinutes: 0 }] };
    const pending = threadsTick({ now: new Date("2026-10-14T12:00:00Z"), config, log: () => {} });
    await vi.waitFor(() => expect(mocks.ensureDailyPack).toHaveBeenCalledOnce());
    expect(mocks.runDue).toHaveBeenCalledOnce();
    expect(mocks.runDue.mock.invocationCallOrder[0]).toBeLessThan(mocks.ensureDailyPack.mock.invocationCallOrder[0]);
    fail(new Error("writer unavailable"));
    const result = await pending;
    expect(result.run.published).toBe(1);
    expect(result.planningError).toBe("writer unavailable");
    expect(mocks.outcome).toHaveBeenCalledWith("threads", expect.objectContaining({ status: "failed", detail: expect.stringContaining("1 posts published") }));
  });
});
