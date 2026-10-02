import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(), withFullTranscript: vi.fn(), readAppData: vi.fn(),
  writeAppData: vi.fn(), generateCarouselBatches: vi.fn(),
}));
vi.mock("@/lib/longform/store", () => ({ getProject: mocks.getProject, withFullTranscript: mocks.withFullTranscript }));
vi.mock("@/lib/clipping/jobs", () => ({ getJob: vi.fn() }));
vi.mock("@/lib/storage/store", () => ({
  readAppData: mocks.readAppData,
  mutateAppData: async (update: (data: unknown) => unknown) => {
    const updated = update(await mocks.readAppData());
    await mocks.writeAppData(updated);
    return updated;
  },
}));
vi.mock("@/lib/studio/carousel", () => ({
  carouselGenerationConfigured: () => true,
  clampBatchCount: () => 1,
  DEFAULT_SLIDE_COUNT: 8,
  generateCarouselBatches: mocks.generateCarouselBatches,
  resolveSlideCount: vi.fn(),
  clipCarouselSource: vi.fn(),
}));

import { POST } from "@/app/api/studio/carousels/generate/route";

describe("long-form carousel generation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("uses later stream words for copy and still anchoring while preserving edits saved during generation", async () => {
    const opening = [{ start: 0, end: 10, text: "Opening words" }];
    const full = [...opening, { start: 3600, end: 3610, text: "Later payoff from the whole stream" }];
    const project = { id: "project", name: "Full stream", sourceId: "source", transcript: opening };
    mocks.getProject.mockResolvedValue(project);
    mocks.withFullTranscript.mockResolvedValue({ ...project, transcript: full });
    mocks.readAppData
      .mockResolvedValueOnce({ settings: { theme: "old" }, videoStudio: { scripts: [], carousels: [{ id: "existing" }] } })
      .mockResolvedValueOnce({ settings: { theme: "new" }, videoStudio: { scripts: [{ id: "edited" }], carousels: [{ id: "parallel" }, { id: "existing" }] } });
    mocks.generateCarouselBatches.mockResolvedValue({ carousels: [{ id: "generated" }], reason: null });

    const response = await POST(new NextRequest("http://localhost:3100/api/studio/carousels/generate", {
      method: "POST", body: JSON.stringify({ longformId: "project" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.withFullTranscript).toHaveBeenCalledWith(project);
    expect(mocks.generateCarouselBatches).toHaveBeenCalledWith(expect.objectContaining({
      sourceText: "Opening words Later payoff from the whole stream", transcript: full, recordingId: "source",
    }));
    expect(mocks.writeAppData).toHaveBeenCalledWith({
      settings: { theme: "new" },
      videoStudio: { scripts: [{ id: "edited" }], carousels: [{ id: "generated" }, { id: "parallel" }, { id: "existing" }] },
    });
  });

  it("keeps using the stored opening transcript when no shared transcript is available", async () => {
    const project = { id: "project", name: "Opening", transcript: [{ start: 0, end: 5, text: "Available transcript" }] };
    mocks.getProject.mockResolvedValue(project);
    mocks.withFullTranscript.mockResolvedValue(project);
    mocks.readAppData.mockResolvedValue({ videoStudio: { scripts: [], carousels: [] } });
    mocks.generateCarouselBatches.mockResolvedValue({ carousels: [{ id: "generated" }], reason: null });
    const response = await POST(new NextRequest("http://localhost:3100/api/studio/carousels/generate", {
      method: "POST", body: JSON.stringify({ longformId: "project" }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.generateCarouselBatches).toHaveBeenCalledWith(expect.objectContaining({ sourceText: "Available transcript" }));
  });
});
