import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ bookShortsPicks: vi.fn(), skipShorts: vi.fn(), shortsReviewState: vi.fn() }));
vi.mock("@/lib/pipeline/shortsReview", async () => {
  class ReviewBusyError extends Error {}
  return { ...mocks, ReviewBusyError, defaultDeps: { tag: "deps" } };
});
import { POST } from "@/app/api/shorts-review/route";
import { ReviewBusyError } from "@/lib/pipeline/shortsReview";

const post = (body: unknown) => POST(new NextRequest("http://localhost:3100/api/shorts-review", { method: "POST", body: JSON.stringify(body) }));

describe("POST /api/shorts-review", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    { action: "book", ids: ["clip:j1:clip-1"] },
    { action: "book", ids: ["clip:j1:clip-1"], confirm: "yes" },
    { action: "book", ids: [], confirm: true },
    { action: "book", ids: ["longform:p1:e1"], confirm: true },
    { action: "approve", ids: ["clip:j1:clip-1"] },
    null
  ])("refuses %j without booking anything", async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(mocks.bookShortsPicks).not.toHaveBeenCalled();
    expect(mocks.skipShorts).not.toHaveBeenCalled();
  });

  it("books exactly the ticked clips once confirmed", async () => {
    mocks.bookShortsPicks.mockResolvedValue({ booked: [], failed: [], stale: [] });
    const response = await post({ action: "book", ids: ["clip:j1:clip-1", "clip:j2:clip-3"], confirm: true });
    expect(response.status).toBe(200);
    expect(mocks.bookShortsPicks).toHaveBeenCalledWith(["clip:j1:clip-1", "clip:j2:clip-3"]);
  });

  it("passes retyped titles through and refuses an empty or over-long one", async () => {
    mocks.bookShortsPicks.mockResolvedValue({ booked: [], failed: [], stale: [] });
    await post({ action: "book", ids: ["clip:j1:clip-1"], confirm: true, titles: { "clip:j1:clip-1": " Claude rebuilt my map in 4 minutes " } });
    expect(mocks.bookShortsPicks).toHaveBeenCalledWith(["clip:j1:clip-1"], { tag: "deps" }, { "clip:j1:clip-1": "Claude rebuilt my map in 4 minutes" });
    mocks.bookShortsPicks.mockClear();
    expect((await post({ action: "book", ids: ["clip:j1:clip-1"], confirm: true, titles: { "clip:j1:clip-1": "x".repeat(101) } })).status).toBe(400);
    expect((await post({ action: "book", ids: ["clip:j1:clip-1"], confirm: true, titles: { "clip:j1:clip-1": "  " } })).status).toBe(400);
    expect(mocks.bookShortsPicks).not.toHaveBeenCalled();
  });

  it("answers 409 while another booking runs", async () => {
    mocks.bookShortsPicks.mockRejectedValue(new ReviewBusyError());
    expect((await post({ action: "book", ids: ["clip:j1:clip-1"], confirm: true })).status).toBe(409);
  });

  it("skips without asking for confirmation, since ticking it on the stream's sheet undoes it", async () => {
    mocks.skipShorts.mockResolvedValue({ skipped: 1, stale: [] });
    expect((await post({ action: "skip", ids: ["clip:j1:clip-1"] })).status).toBe(200);
    expect(mocks.bookShortsPicks).not.toHaveBeenCalled();
  });
});
