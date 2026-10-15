import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/threads/route";
import { threadsConfig } from "@/lib/threads/config";
import { readQueue, writeQueue } from "@/lib/threads/queue";
import { runDue } from "@/lib/threads/runner";
import type { ThreadsQueueItem } from "@/lib/threads/types";

const NOW = new Date("2026-10-14T12:01:00Z");
function row(overrides: Partial<ThreadsQueueItem> = {}): ThreadsQueueItem {
  return { id: "fixture-skip", batchDate: "2026-10-14", slot: 1, accountId: "primary", version: "text",
    topic: "Fixture", format: "insight", text: "Reviewed fixture text", status: "pending", attempts: 0,
    publishAt: "2026-10-14T12:00:00Z", createdAt: "2026-10-14T11:00:00Z", ...overrides };
}
function skipRequest() {
  return new NextRequest("http://localhost:3100/api/threads", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "skip", id: "fixture-skip" }) });
}
function config() {
  return { ...threadsConfig(), enabled: true, timezone: "UTC", plugReplies: false,
    accounts: [{ id: "primary", label: "Fixture", userId: "fixture-user", accessToken: "fixture-token", posts: "text" as const, offsetMinutes: 0 }] };
}
afterEach(() => vi.unstubAllGlobals());

describe("skipping a Threads delivery", () => {
  it.each([
    { claimedAt: NOW.toISOString() },
    { containerId: "fixture-container" },
    { publishAttemptedAt: NOW.toISOString() },
    { postId: "fixture-receipt" }
  ])("rejects a skip after delivery has started: %j", async (evidence) => {
    const original = row(evidence);
    await writeQueue([original]);
    const response = await POST(skipRequest());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: expect.stringContaining("started sending") });
    expect(await readQueue()).toEqual([original]);
  });

  it.each(["none", "reschedule", "shift"] as const)("rejects skip after %s while container creation waits and retains the receipt", async (precedingAction) => {
    await writeQueue([row()]);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/threads")) {
        await waiting;
        return new Response(JSON.stringify({ id: "fixture-container" }));
      }
      expect(url).toContain("/threads_publish");
      expect((await readQueue())[0].publishAttemptedAt).toBeTruthy();
      return new Response(JSON.stringify({ id: "fixture-receipt" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const sending = runDue(NOW, { config: config(), log: () => {} });
    try {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const claimed = await readQueue();
      expect(claimed[0].claimedAt).toBeTruthy();
      if (precedingAction !== "none") {
        const body = precedingAction === "reschedule"
          ? { action: "reschedule", id: "fixture-skip", at: "2026-10-14T18:00:00Z" }
          : { action: "shift", date: "2026-10-14", minutes: 30 };
        const moved = await POST(new NextRequest("http://localhost:3100/api/threads", { method: "POST",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
        expect(moved.status).toBe(400);
        expect(await moved.json()).toEqual({ error: expect.stringContaining("started sending") });
        expect(await readQueue()).toEqual(claimed);
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }
      const response = await POST(skipRequest());
      expect(response.status).toBe(409);
      expect(await readQueue()).toEqual(claimed);
    } finally {
      release();
      await sending;
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await readQueue())[0]).toMatchObject({ status: "published", containerId: "fixture-container", postId: "fixture-receipt" });
  });

  it("keeps an untouched skip ahead of the runner claim and makes no provider request", async () => {
    await writeQueue([row()]);
    const fetchMock = vi.fn(async () => { throw new Error("No provider request is allowed"); });
    vi.stubGlobal("fetch", fetchMock);
    expect((await POST(skipRequest())).status).toBe(200);
    const skipped = await readQueue();
    expect(skipped[0]).toMatchObject({ status: "skipped", note: "Skipped by hand from the dashboard." });
    expect(skipped[0].claimedAt).toBeUndefined();
    await runDue(NOW, { config: config(), log: () => {} });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual(skipped);
  });
});
