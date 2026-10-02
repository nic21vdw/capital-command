import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/threads/route";
import type { ThreadsQueueItem } from "@/lib/threads/types";

const mocks = vi.hoisted(() => ({ read: vi.fn(), paused: vi.fn(), mutate: vi.fn(), run: vi.fn(), tick: vi.fn(), plan: vi.fn() }));
vi.mock("@/lib/threads/queue", () => ({
  readQueue: mocks.read, mutateQueue: mocks.mutate, editItemText: vi.fn(), rescheduleItem: vi.fn(), retryItem: vi.fn(), shiftBatch: vi.fn(),
  summarizeBatch: vi.fn(() => ({ date: "2026-10-02", total: 1, published: 1, pending: 0, failed: 0, skipped: 0, accounts: [] })),
  summarizeBatches: vi.fn(() => [])
}));
vi.mock("@/lib/threads/state", () => ({ readThreadsState: vi.fn(async () => ({})), tickHealth: vi.fn(() => ({ healthy: true, minutesSince: 1 })) }));
vi.mock("@/lib/automations/store", () => ({ isAutomationPaused: mocks.paused }));
vi.mock("@/lib/threads/runner", () => ({ runDue: mocks.run }));
vi.mock("@/lib/threads/daily", () => ({ planTodaysBatch: mocks.plan, threadsTick: mocks.tick }));
vi.mock("@/lib/threads/api", () => ({ checkAllAccounts: vi.fn() }));

const queued: ThreadsQueueItem = {
  id: "post-1", batchDate: "2026-10-02", slot: 1, accountId: "primary", version: "text", topic: "Build tools", format: "story",
  text: "Building tools in CoLateral.", publishAt: "2026-10-02T15:00:00.000Z", status: "published", postId: "threads-1", attempts: 0,
  publishedAt: "2026-10-02T15:10:00.000Z", createdAt: "2026-10-02T14:00:00.000Z"
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-02T15:20:00.000Z"));
  vi.stubEnv("THREADS_ACCESS_TOKEN", "sensitive-token-for-test");
  vi.stubEnv("THREADS_USER_ID", "sensitive-user-id-for-test");
  mocks.read.mockResolvedValue([queued]);
  mocks.paused.mockResolvedValue(false);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("Threads status reply previews", () => {
  it("reports safe reply policy and per-post previews without posting or mutating the queue", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.settings.replyPolicy).toMatchObject({ enabled: true, delayMinutes: 2, windowMinutes: 360 });
    expect(body.replies.today).toMatchObject({ total: 1, pending: 1, delivered: 0 });
    expect(body.replies.items[0]).toMatchObject({ itemId: "post-1", status: "pending" });
    expect(body.replies.items[0].text).toContain("colateralai.com");
    expect(body.settings.accounts[0]).toEqual({ id: "primary", label: "primary", posts: "text", offsetMinutes: 0 });
    expect(JSON.stringify(body)).not.toContain("sensitive-token-for-test");
    expect(JSON.stringify(body)).not.toContain("sensitive-user-id-for-test");
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.tick).not.toHaveBeenCalled();
    expect(mocks.plan).not.toHaveBeenCalled();
  });

  it("does not report ready follow-ups while Threads is paused", async () => {
    mocks.paused.mockResolvedValue(true);
    const body = await (await GET()).json();
    expect(body.settings.replyPolicy).toMatchObject({ enabled: false, disabledReason: "Threads automation is paused." });
    expect(body.replies.today).toMatchObject({ disabled: 1, pending: 0 });
  });

  it("keeps the published reply visible after disabling follow-ups", async () => {
    vi.stubEnv("THREADS_PLUG_REPLY", "false");
    mocks.read.mockResolvedValue([{ ...queued, plugText: "Published follow-up", plugPostId: "reply-1" }]);
    const body = await (await GET()).json();
    expect(body.replies.items[0]).toMatchObject({ text: "Published follow-up", status: "delivered" });
    expect(body.replies.today.delivered).toBe(1);
    expect(body.settings.replyPolicy.enabled).toBe(false);
  });

  it("redacts credentials from stored queue errors and reply errors", async () => {
    mocks.read.mockResolvedValue([{ ...queued, error: "Provider sensitive-token-for-test", plugError: "Bearer secret-error-token", plugAttempts: 1, plugText: "Frozen copy" }]);
    const body = await (await GET()).json();
    expect(body.items[0].error).toBe("Provider [hidden]");
    expect(body.items[0].plugError).toBe("Bearer [hidden]");
    expect(body.replies.items[0].error).toBe("Bearer [hidden]");
    expect(JSON.stringify(body)).not.toContain("sensitive-token-for-test");
    expect(JSON.stringify(body)).not.toContain("secret-error-token");
  });
});
