import { rm } from "node:fs/promises";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { isAutomationPaused } from "@/lib/automations/store";
import { readAppData } from "@/lib/storage/store";
import { GET, PATCH } from "@/app/api/automations/route";

const overview = vi.hoisted(() => vi.fn());
vi.mock("@/lib/automations/overview", () => ({ automationOverview: overview }));

beforeEach(async () => {
  await rm(dataPath("automations"), { recursive: true, force: true });
  vi.clearAllMocks();
});

function request(body: unknown, origin = "http://localhost:3100") {
  return new NextRequest("http://localhost:3100/api/automations", { method: "PATCH", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body) });
}

describe("automation control API", () => {
  it("persists pause and resume without running a publisher", async () => {
    expect((await PATCH(request({ action: "pause", id: "publisher", paused: true }))).status).toBe(200);
    expect(await isAutomationPaused("publisher")).toBe(true);
    expect((await PATCH(request({ action: "pause", id: "publisher", paused: false }))).status).toBe(200);
    expect(await isAutomationPaused("publisher")).toBe(false);
    expect(overview).not.toHaveBeenCalled();
  });

  it.each([
    { action: "pause", id: "publisher", paused: "false" },
    { action: "pause", id: "arbitrary-task", paused: false },
    { action: "publish-now", id: "publisher" },
    { action: "pause", id: "publisher", paused: false, token: "test-token" }
  ])("rejects unsupported or ambiguous input: %j", async (body) => {
    expect((await PATCH(request(body))).status).toBe(400);
    expect(await isAutomationPaused("publisher")).toBe(false);
  });

  it("rejects changes from another origin", async () => {
    expect((await PATCH(request({ action: "pause", id: "publisher", paused: true }, "https://outside.example"))).status).toBe(403);
    expect(await isAutomationPaused("publisher")).toBe(false);
  });

  it("writes the existing overnight scheduling gate without changing other settings", async () => {
    const before = await readAppData();
    expect((await PATCH(request({ action: "overnight-scheduling", enabled: true }))).status).toBe(200);
    const after = await readAppData();
    expect(after.settings).toEqual({ ...before.settings, autoScheduleOvernight: true });
  });

  it("returns unavailable rather than healthy when worker state cannot be read", async () => {
    overview.mockRejectedValueOnce(new Error("The saved controls are unreadable."));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "The saved controls are unreadable." });
  });
});
