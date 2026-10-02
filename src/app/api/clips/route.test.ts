import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createJobFromUpload: vi.fn(), createJobFromUrl: vi.fn() }));
vi.mock("@/lib/clipping/ffmpeg", () => ({ resolveFfmpeg: () => "ffmpeg", runFfmpeg: vi.fn(async () => ({})), FFMPEG_MISSING_MESSAGE: "Missing" }));
vi.mock("@/lib/clipping/jobs", () => ({ ...mocks, jobWithoutCaptions: vi.fn(), listJobs: vi.fn() }));
import { POST } from "@/app/api/clips/route";

describe("clip job request validation", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each([null, [], "url", 1, true])("returns 400 for a non-object body (%j) without starting work", async (body) => {
    const response = await POST(new NextRequest("http://localhost:3100/api/clips", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(400);
    expect(mocks.createJobFromUpload).not.toHaveBeenCalled();
    expect(mocks.createJobFromUrl).not.toHaveBeenCalled();
  });

  it("still passes valid source jobs and framing settings to the existing generator", async () => {
    mocks.createJobFromUpload.mockResolvedValue({ id: "job" });
    const response = await POST(new NextRequest("http://localhost:3100/api/clips", {
      method: "POST", body: JSON.stringify({ sourceId: " source ", topic: " topic ", clipCount: 4, autoFrame: false }),
    }));
    expect(response.status).toBe(201);
    expect(mocks.createJobFromUpload).toHaveBeenCalledWith("source", "topic", 4, false, { captionPreset: undefined, clipLength: undefined });
  });
});
