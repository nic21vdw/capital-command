import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createRunFromSource: vi.fn(), createRunFromUrl: vi.fn(), updateRun: vi.fn() }));
vi.mock("@/lib/clipping/ffmpeg", () => ({ resolveFfmpeg: () => "ffmpeg", FFMPEG_MISSING_MESSAGE: "Missing" }));
vi.mock("@/lib/pipeline/runs", () => ({ ...mocks, listRuns: vi.fn(), overviewContext: vi.fn(), runOverview: vi.fn() }));
vi.mock("@/lib/ingest/service", () => ({ ingestOverview: vi.fn() }));
vi.mock("@/lib/ingest/run", () => ({ ingestLedger: vi.fn() }));
vi.mock("@/lib/storage/store", () => ({ readAppData: vi.fn() }));
import { POST } from "@/app/api/pipeline/route";

describe("pipeline start request validation", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each([null, [], "url", 1, true])("returns 400 for a non-object body (%j) without starting work", async (body) => {
    const response = await POST(new NextRequest("http://localhost:3100/api/pipeline", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(400);
    expect(mocks.createRunFromSource).not.toHaveBeenCalled();
    expect(mocks.createRunFromUrl).not.toHaveBeenCalled();
  });

  it("still starts valid uploaded sources with their output quality", async () => {
    mocks.createRunFromSource.mockResolvedValue({ id: "run" });
    const output = { resolution: "1080p", frameRate: "source" };
    const response = await POST(new NextRequest("http://localhost:3100/api/pipeline", {
      method: "POST", body: JSON.stringify({ sourceId: " source ", name: " Name ", output }),
    }));
    expect(response.status).toBe(201);
    expect(mocks.createRunFromSource).toHaveBeenCalledWith("source", "Name", output);
    expect(mocks.updateRun).not.toHaveBeenCalled();
  });
});
