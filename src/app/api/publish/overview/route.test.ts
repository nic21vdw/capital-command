import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  enabled: true,
  paused: false,
  aiCopy: true,
  task: { state: "ready", nextRunAt: "2026-10-10T12:05:00.000Z", lastRunAt: "2026-10-10T12:00:00.000Z", lastResult: 0, schedule: null } as
    | { state: string; nextRunAt: string | null; lastRunAt: string | null; lastResult: number | null; schedule: string | null }
    | undefined
}));

vi.mock("@/lib/publisher/config", () => ({
  publisherConfig: () => ({
    enabled: state.enabled,
    timezone: "America/Toronto",
    slotTimes: ["07:30", "12:30"],
    weekendSlotTimes: ["09:00"],
    shortsPerDay: 3,
    mirror: { enabled: true, lead: "youtube", targets: ["instagram", "facebook"], mode: "match" }
  })
}));
vi.mock("@/lib/publisher/ai-copy", () => ({ platformCopyConfigured: () => state.aiCopy }));
vi.mock("@/lib/publisher/queue", () => ({ publishQueue: () => ({ list: async () => [] }) }));
vi.mock("@/lib/publisher/quota", () => ({ youtubeQuota: () => ({ uploadsUsed: 0 }) }));
vi.mock("@/lib/automations/store", () => ({ isAutomationPaused: async () => state.paused }));
vi.mock("@/lib/automations/tasks", () => ({
  readAutomationTasks: async () => (state.task ? { publisher: state.task } : {})
}));

const get = async () => {
  const { GET } = await import("@/app/api/publish/overview/route");
  const response = await GET(new NextRequest("http://localhost:3000/api/publish/overview"));
  return response.json();
};

describe("GET /api/publish/overview", () => {
  beforeEach(() => {
    state.enabled = true;
    state.paused = false;
    state.aiCopy = true;
    state.task = { state: "ready", nextRunAt: "2026-10-10T12:05:00.000Z", lastRunAt: "2026-10-10T12:00:00.000Z", lastResult: 0, schedule: null };
  });

  it("reports the shorts cap, the mirror and the publisher's state", async () => {
    const body = await get();
    expect(body.shortsPerDay).toBe(3);
    expect(body.mirror).toEqual({ enabled: true, lead: "youtube", targets: ["instagram", "facebook"] });
    expect(body.automation).toEqual({
      paused: false,
      task: { state: "ready", lastRunAt: "2026-10-10T12:00:00.000Z", nextRunAt: "2026-10-10T12:05:00.000Z" }
    });
  });

  it("says whether captions can be written by a model, as a bare boolean", async () => {
    expect((await get()).aiCopyAvailable).toBe(true);
    state.aiCopy = false;
    const body = await get();
    expect(body.aiCopyAvailable).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/key|token|secret/i);
  });

  it("says paused, and unknown when the task could not be read", async () => {
    state.paused = true;
    state.task = undefined;
    const body = await get();
    expect(body.automation).toEqual({ paused: true, task: { state: "unknown", lastRunAt: null, nextRunAt: null } });
  });

  it("still answers while posting is off", async () => {
    state.enabled = false;
    const body = await get();
    expect(body.enabled).toBe(false);
    expect(body.shortsPerDay).toBe(3);
  });
});
