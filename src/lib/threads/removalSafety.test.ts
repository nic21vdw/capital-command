import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/threads/route";
import { readQueue, writeQueue } from "@/lib/threads/queue";
import type { ThreadsQueueItem } from "@/lib/threads/types";

function row(overrides: Partial<ThreadsQueueItem> = {}): ThreadsQueueItem {
  return { id: "fixture-row", batchDate: "2026-10-14", slot: 1, accountId: "primary", version: "text",
    topic: "Fixture", format: "insight", text: "Reviewed fixture text", status: "pending", attempts: 0,
    publishAt: "2026-10-14T12:00:00Z", createdAt: "2026-10-14T11:00:00Z", ...overrides };
}
function removeRequest() {
  return new NextRequest("http://localhost:3100/api/threads", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", id: "fixture-row" }) });
}
afterEach(() => vi.unstubAllGlobals());

describe("removing a Threads delivery", () => {
  it.each([
    { publishAttemptedAt: "2026-10-14T12:00:00Z" },
    { containerId: "legacy-container" },
    { status: "published" as const, postId: "saved-parent", plugContainerId: "saved-reply-container", plugPublishAttemptedAt: "2026-10-14T12:02:00Z" }
  ])("retains unresolved delivery evidence: %j", async (evidence) => {
    const fetchMock = vi.fn(async () => { throw new Error("No provider call is allowed"); });
    vi.stubGlobal("fetch", fetchMock);
    const original = row(evidence);
    await writeQueue([original]);
    const response = await POST(removeRequest());
    expect(response.status).toBe(409);
    expect(await readQueue()).toEqual([original]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still removes an untouched draft", async () => {
    await writeQueue([row()]);
    expect((await POST(removeRequest())).status).toBe(200);
    expect(await readQueue()).toEqual([]);
  });
});
