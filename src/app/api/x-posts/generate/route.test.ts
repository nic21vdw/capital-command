import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/x-posts/generate/route";
import type { ThreadsQueueItem } from "@/lib/threads/types";

const mocks = vi.hoisted(() => ({ read: vi.fn(), paused: vi.fn(), ensure: vi.fn(), plan: vi.fn() }));
vi.mock("@/lib/threads/queue", () => ({ readQueue: mocks.read }));
vi.mock("@/lib/automations/store", () => ({ isAutomationPaused: mocks.paused }));
vi.mock("@/lib/x-posts/daily", () => ({ ensureDailyPack: mocks.ensure }));
vi.mock("@/lib/threads/daily", () => ({ planTodaysBatch: mocks.plan }));
vi.mock("@/lib/x-posts/generator", () => ({ plannerConfigured: () => false }));

const DATE = "2026-10-11";
const pack = { id: "p", date: DATE, source: "library", posts: [], replies: [], createdAt: "2026-10-11T12:00:00.000Z" };

function row(slot: number, status: ThreadsQueueItem["status"], extra: Partial<ThreadsQueueItem> = {}) {
  return { id: `r${slot}-${status}`, batchDate: DATE, slot, accountId: "primary", status, ...extra } as ThreadsQueueItem;
}

function call(body: unknown) {
  return POST(new NextRequest("http://localhost/api/x-posts/generate", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-11T16:00:00.000Z"));
  vi.stubEnv("THREADS_ACCESS_TOKEN", "token-for-test");
  vi.stubEnv("THREADS_TIMEZONE", "America/Toronto");
  mocks.paused.mockResolvedValue(false);
  mocks.read.mockResolvedValue([]);
  mocks.ensure.mockResolvedValue({ pack, cached: false, reason: null });
  mocks.plan.mockResolvedValue({ date: DATE, created: 2, droppedPastSlots: 0 });
});

describe("POST /api/x-posts/generate", () => {
  it("refuses a rewrite once a post has gone out, without generating or touching the queue", async () => {
    mocks.read.mockResolvedValue([row(1, "published", { postId: "t1" }), row(2, "pending")]);
    const response = await call({ force: true });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("Today's posts have started going out - edit or skip individual posts instead.");
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.plan).not.toHaveBeenCalled();
  });

  it("refuses a rewrite while a send is in flight even though the row still reads pending", async () => {
    mocks.read.mockResolvedValue([row(1, "pending", { claimedAt: "2026-10-11T15:59:00.000Z" })]);
    expect((await call({ force: true })).status).toBe(409);
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it("replaces the waiting queue from the new pack, using the pack just written", async () => {
    mocks.read.mockResolvedValue([row(1, "pending"), row(2, "pending")]);
    const response = await call({ force: true });
    expect(response.status).toBe(200);
    expect(mocks.ensure).toHaveBeenCalledWith(expect.objectContaining({ force: true, keepWritten: true, date: DATE }));
    expect(mocks.plan).toHaveBeenCalledWith(expect.objectContaining({ replacePending: true }));
    // No second model call: planning must not force again.
    expect(mocks.plan.mock.calls[0][0]).not.toHaveProperty("force");
    const body = await response.json();
    expect(body.queue).toMatchObject({ replaced: 2, plan: { created: 2 } });
  });

  it("leaves the queue alone when the written pack was kept because only the idea library was available", async () => {
    mocks.read.mockResolvedValue([row(1, "pending")]);
    mocks.ensure.mockResolvedValue({ pack, cached: true, reason: "Kept today's pack: AI is not configured." });
    const response = await call({ force: true });
    expect(response.status).toBe(200);
    expect(mocks.plan).not.toHaveBeenCalled();
    expect((await response.json()).reason).toContain("Kept today's pack");
  });

  it("leaves the queue alone when nothing is queued for today", async () => {
    const response = await call({ force: true });
    expect(response.status).toBe(200);
    expect(mocks.plan).not.toHaveBeenCalled();
    expect((await response.json()).queue).toBeUndefined();
  });

  it("refuses to leave old copy queued behind a new pack when the autopilot is paused", async () => {
    mocks.paused.mockResolvedValue(true);
    mocks.read.mockResolvedValue([row(1, "pending")]);
    expect((await call({ force: true })).status).toBe(409);
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it("does not gate or re-plan the ordinary first-of-the-day request", async () => {
    mocks.read.mockResolvedValue([row(1, "published", { postId: "t1" })]);
    mocks.ensure.mockResolvedValue({ pack, cached: true, reason: null });
    const response = await call({});
    expect(response.status).toBe(200);
    expect(mocks.plan).not.toHaveBeenCalled();
  });
});
